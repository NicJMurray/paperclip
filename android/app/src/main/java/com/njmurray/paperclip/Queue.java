package com.njmurray.paperclip;

import android.content.Context;
import androidx.work.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

final class Queue {
    static File root(Context c){File root=new File(c.getFilesDir(),"outbox");root.mkdirs();return root;}
    private static File removalRoot(Context c){File root=new File(c.getFilesDir(),"removals");root.mkdirs();return root;}
    private static File[] allEntries(Context c){File[] list=root(c).listFiles(f->f.isDirectory()&&!f.getName().startsWith("."));return list==null?new File[0]:list;}
    static File[] entries(Context c){return Arrays.stream(allEntries(c)).filter(f->!cancelled(c,f.getName())).sorted(Comparator.comparingLong(Queue::createdAt).reversed()).toArray(File[]::new);}
    static long createdAt(File dir){try{return new JSONObject(read(new File(dir,"meta.json"))).optLong("created_at",new File(dir,"meta.json").lastModified());}catch(Exception e){return dir.lastModified();}}
    static String label(JSONObject meta,boolean image){
        String text=meta.optString("text");java.util.regex.Matcher url=java.util.regex.Pattern.compile("https?://[^\\s<>\"']+").matcher(text);
        if(url.find())return url.group();String title=meta.optString("title").trim();
        return !title.isEmpty()?title:image?"Image":text.trim().isEmpty()?"Text":text.trim();
    }
    static boolean cancelled(Context c,String id){return new File(removalRoot(c),id).isFile();}
    static void cancel(Context c,String id)throws IOException{
        if(id==null||!id.matches("[0-9a-f-]{36}"))throw new IOException("Invalid queue item.");
        // Kept outside the outbox folder: an upload acknowledgement may remove
        // that folder concurrently, but must not erase the removal request.
        write(new File(removalRoot(c),id),id);schedule(c,id,true);
    }
    static void clearCancellation(Context c,String id){new File(removalRoot(c),id).delete();}
    static void schedule(Context c,String id,boolean replace){
        OneTimeWorkRequest job=new OneTimeWorkRequest.Builder(UploadWorker.class).setInputData(new Data.Builder().putString("id",id).build()).setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build();
        WorkManager.getInstance(c).enqueueUniqueWork("share-"+id,replace?ExistingWorkPolicy.REPLACE:ExistingWorkPolicy.KEEP,job);
    }
    static void recover(Context c,boolean retry){
        for(File dir:entries(c))if(retry||!new File(dir,"error").exists())schedule(c,dir.getName(),retry);
        File[] removals=removalRoot(c).listFiles(File::isFile);if(removals!=null)for(File file:removals)schedule(c,file.getName(),retry);
    }
    static void write(File file,String text)throws IOException{try(FileOutputStream out=new FileOutputStream(file)){out.write(text.getBytes(StandardCharsets.UTF_8));out.getFD().sync();}}
    static String read(File file)throws IOException{return new String(java.nio.file.Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8);}
    static void remove(File dir){File[] list=dir.listFiles();if(list!=null)for(File f:list)f.delete();dir.delete();}
    static void error(File dir,String text){try{write(new File(dir,"error"),text);}catch(IOException ignored){}}
}
