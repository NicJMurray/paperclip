package com.njmurray.paperclip;

import android.content.Context;
import androidx.work.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

final class Queue {
    static File root(Context c){File root=new File(c.getFilesDir(),"outbox");root.mkdirs();return root;}
    static File[] entries(Context c){File[] list=root(c).listFiles(f->f.isDirectory()&&!f.getName().startsWith("."));return list==null?new File[0]:list;}
    static void schedule(Context c,String id,boolean replace){
        OneTimeWorkRequest job=new OneTimeWorkRequest.Builder(UploadWorker.class).setInputData(new Data.Builder().putString("id",id).build()).setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build();
        WorkManager.getInstance(c).enqueueUniqueWork("share-"+id,replace?ExistingWorkPolicy.REPLACE:ExistingWorkPolicy.KEEP,job);
    }
    static void recover(Context c,boolean retry){for(File dir:entries(c))if(retry||!new File(dir,"error").exists())schedule(c,dir.getName(),retry);}
    static void write(File file,String text)throws IOException{try(FileOutputStream out=new FileOutputStream(file)){out.write(text.getBytes(StandardCharsets.UTF_8));out.getFD().sync();}}
    static String read(File file)throws IOException{return new String(java.nio.file.Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8);}
    static void remove(File dir){File[] list=dir.listFiles();if(list!=null)for(File f:list)f.delete();dir.delete();}
    static void error(File dir,String text){try{write(new File(dir,"error"),text);}catch(IOException ignored){}}
}
