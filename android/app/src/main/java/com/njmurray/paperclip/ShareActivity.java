package com.njmurray.paperclip;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.widget.Toast;
import java.io.*;
import java.util.*;
import org.json.JSONObject;

public class ShareActivity extends Activity {
    private static final long MAX_IMAGE=10L*1024*1024;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        if(state!=null){finish();return;}
        Intent intent=getIntent();
        new Thread(()->{
            int saved=0;String problem=null;
            try{
                String action=intent.getAction();
                if(!Intent.ACTION_SEND.equals(action)&&!Intent.ACTION_SEND_MULTIPLE.equals(action)&&!Intent.ACTION_PROCESS_TEXT.equals(action))throw new IOException("Share a link or image to Paperclip.");
                CharSequence shared=intent.getCharSequenceExtra(Intent.ACTION_PROCESS_TEXT.equals(action)?Intent.EXTRA_PROCESS_TEXT:Intent.EXTRA_TEXT);
                String text=shared==null?"":shared.toString();String title=intent.getStringExtra(Intent.EXTRA_SUBJECT);if(title==null)title="";
                if(text.length()>32000)throw new IOException("This text is too long to save (32,000 characters maximum).");
                if(title.length()>500)title=title.substring(0,500);
                ArrayList<Uri> uris=new ArrayList<>();
                if(Intent.ACTION_SEND_MULTIPLE.equals(action)){
                    ArrayList<Uri> incoming=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);if(incoming!=null)uris.addAll(incoming);
                }else{
                    Uri uri=intent.getParcelableExtra(Intent.EXTRA_STREAM);if(uri!=null)uris.add(uri);
                }
                if(uris.isEmpty()&&intent.getClipData()!=null)for(int i=0;i<intent.getClipData().getItemCount();i++){
                    Uri uri=intent.getClipData().getItemAt(i).getUri();if(uri!=null&&"content".equals(uri.getScheme()))uris.add(uri);
                }
                if(uris.size()>30)throw new IOException("Share up to 30 images at a time.");
                if(uris.isEmpty()){
                    if(text.trim().isEmpty())throw new IOException("There is no link, text or image to save.");
                    save(text,title,null);saved++;
                }else for(Uri uri:uris){save(text,title,uri);saved++;}
            }catch(Exception e){problem=e.getMessage()==null?"Could not copy this share. Please try sharing it again.":e.getMessage();}
            final int count=saved;final String message=problem;
            runOnUiThread(()->{
                if(count>0)Toast.makeText(this,count==1?"Queued in Paperclip":"Queued "+count+" items",Toast.LENGTH_SHORT).show();
                if(message!=null)Toast.makeText(this,(count>0?"Some items were saved. ":"")+message,Toast.LENGTH_LONG).show();
                if(count>0&&Settings.token(this)==null)startActivity(new Intent(this,MainActivity.class));
                finish();
            });
        },"paperclip-copy").start();
    }
    private void save(String text,String title,Uri uri)throws Exception{
        String id=UUID.randomUUID().toString();File staging=new File(Queue.root(this),"."+id);if(!staging.mkdir())throw new IOException("Not enough space on this phone.");
        try{
            JSONObject meta=new JSONObject().put("id",id).put("text",text).put("title",title);
            if(uri!=null){
                // Never read arbitrary filesystem paths supplied by another app.
                if(!"content".equals(uri.getScheme()))throw new IOException("This app did not provide a readable image.");
                String type=getContentResolver().getType(uri);if(type==null||!type.startsWith("image/"))throw new IOException("Paperclip saves links, text and images.");
                File image=new File(staging,"image");
                try(InputStream in=getContentResolver().openInputStream(uri);FileOutputStream out=new FileOutputStream(image)){
                    if(in==null)throw new IOException("Could not read this image.");byte[] buffer=new byte[32768];long size=0;int n;
                    while((n=in.read(buffer))!=-1){size+=n;if(size>MAX_IMAGE)throw new IOException("This image is over 10 MB. Share a smaller copy.");out.write(buffer,0,n);}out.getFD().sync();
                }
                if(image.length()==0)throw new IOException("This image is empty.");
                if(!Arrays.asList("image/jpeg","image/png","image/gif","image/webp").contains(type)){
                    Bitmap bitmap=decode(image,2400);if(bitmap==null)throw new IOException("This image format could not be opened.");
                    try(FileOutputStream out=new FileOutputStream(image)){bitmap.compress(Bitmap.CompressFormat.JPEG,90,out);out.getFD().sync();}finally{bitmap.recycle();}type="image/jpeg";
                }
                meta.put("mime",type);
                Bitmap preview=decode(image,320);
                if(preview!=null){
                    ByteArrayOutputStream bytes=new ByteArrayOutputStream();preview.compress(Bitmap.CompressFormat.JPEG,65,bytes);preview.recycle();
                    if(bytes.size()<=40000)try(FileOutputStream out=new FileOutputStream(new File(staging,"preview.jpg"))){bytes.writeTo(out);out.getFD().sync();}
                }
            }
            Queue.write(new File(staging,"meta.json"),meta.toString());
            File queued=new File(Queue.root(this),id);if(!staging.renameTo(queued))throw new IOException("Could not store this share on the phone.");
            Queue.schedule(getApplicationContext(),id,false);
        }finally{if(staging.exists())Queue.remove(staging);}
    }
    private Bitmap decode(File file,int bound){
        try{
            BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeFile(file.getPath(),options);
            if(options.outWidth<=0||options.outHeight<=0)return null;
            options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>bound)options.inSampleSize*=2;
            options.inJustDecodeBounds=false;return BitmapFactory.decodeFile(file.getPath(),options);
        }catch(OutOfMemoryError e){return null;}
    }
}
