package com.njmurray.paperclip;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class Network {
    static class Response {
        final int code; final JSONObject body;
        Response(int code, JSONObject body) { this.code=code; this.body=body; }
        boolean ok() { return code>=200 && code<300; }
    }
    private static HttpURLConnection connection(String path, String token) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(Settings.ORIGIN+path).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000); c.setInstanceFollowRedirects(false);
        if(token!=null)c.setRequestProperty("Authorization","Bearer "+token);
        return c;
    }
    private static Response response(HttpURLConnection c) throws Exception {
        int code=c.getResponseCode(); InputStream source=code<400?c.getInputStream():c.getErrorStream();
        String text="{}";
        if(source!=null)try(InputStream in=source){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[2048];int n;while(bytes.size()<16384&&(n=in.read(buffer,0,Math.min(buffer.length,16384-bytes.size())))!=-1)bytes.write(buffer,0,n);text=new String(bytes.toByteArray(),StandardCharsets.UTF_8);}
        JSONObject body; try{body=new JSONObject(text);}catch(Exception e){body=new JSONObject().put("error","The server is unavailable. Try again later.");}
        return new Response(code,body);
    }
    static Response pair(String code) throws Exception {
        HttpURLConnection c=connection("/api/pair",null);
        try {
            c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");
            byte[] bytes=new JSONObject().put("code",code).put("name",android.os.Build.MANUFACTURER+" "+android.os.Build.MODEL).toString().getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}return response(c);
        } finally {c.disconnect();}
    }
    static Response check(String token) throws Exception {
        HttpURLConnection c=connection("/api/device",token);try{return response(c);}finally{c.disconnect();}
    }
    private static void write(OutputStream out,String text)throws IOException{out.write(text.getBytes(StandardCharsets.UTF_8));}
    private static void field(OutputStream out,String boundary,String name,String value)throws IOException{
        write(out,"--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n");
    }
    private static void file(OutputStream out,String boundary,String name,File file,String mime)throws IOException{
        write(out,"--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"; filename=\"image\"\r\nContent-Type: "+mime+"\r\n\r\n");
        try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}write(out,"\r\n");
    }
    static Response upload(File dir,JSONObject meta,String token)throws Exception{
        HttpURLConnection c=connection("/api/capture",token);String boundary="Paperclip"+java.util.UUID.randomUUID().toString().replace("-","");
        try{
            c.setRequestMethod("POST");c.setDoOutput(true);c.setChunkedStreamingMode(32768);c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);
            try(OutputStream out=new BufferedOutputStream(c.getOutputStream())){
                field(out,boundary,"id",meta.getString("id"));field(out,boundary,"text",meta.optString("text"));field(out,boundary,"title",meta.optString("title"));
                File image=new File(dir,"image");if(image.isFile())file(out,boundary,"file",image,meta.optString("mime","image/jpeg"));
                File preview=new File(dir,"preview.jpg");if(preview.isFile())file(out,boundary,"preview",preview,"image/jpeg");
                write(out,"--"+boundary+"--\r\n");
            }return response(c);
        }finally{c.disconnect();}
    }
}
