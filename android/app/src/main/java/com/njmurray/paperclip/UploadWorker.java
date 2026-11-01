package com.njmurray.paperclip;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.*;
import java.io.File;
import org.json.JSONObject;

public class UploadWorker extends Worker {
    public UploadWorker(@NonNull Context context,@NonNull WorkerParameters params){super(context,params);}
    @NonNull @Override public Result doWork(){
        String id=getInputData().getString("id");if(id==null||!id.matches("[0-9a-f-]{36}"))return Result.failure();
        File dir=new File(Queue.root(getApplicationContext()),id);
        if(!dir.isDirectory()&&!Queue.cancelled(getApplicationContext(),id))return Result.success();
        String token=Settings.token(getApplicationContext());
        if(token==null){Queue.error(dir,"Connect this phone to upload.");return Result.failure();}
        try{
            if(Queue.cancelled(getApplicationContext(),id))return remove(id,dir,token);
            JSONObject meta=new JSONObject(Queue.read(new File(dir,"meta.json")));
            Network.Response response=Network.upload(dir,meta,token);
            if(Queue.cancelled(getApplicationContext(),id))return remove(id,dir,token);
            if(response.code==410){Queue.remove(dir);return Result.success();}
            if(response.ok()&&response.body.optBoolean("saved")&&id.equals(response.body.optString("id"))){Queue.remove(dir);return Result.success();}
            if(response.code==401||response.code==403){Queue.error(dir,"Pair this phone again, then tap Retry uploads.");return Result.failure();}
            if(response.code==408||response.code==429||response.code>=500){Queue.error(dir,"Waiting for the server. Will retry automatically.");return Result.retry();}
            Queue.error(dir,response.body.optString("error","Could not upload. Tap Retry uploads."));return Result.failure();
        }catch(Exception e){Queue.error(dir,"Waiting for a connection. Will retry automatically.");return Result.retry();}
    }
    private Result remove(String id,File dir,String token)throws Exception{
        Network.Response response=Network.remove(id,token);
        if(response.ok()&&response.body.optBoolean("removed")){
            Queue.remove(dir);Queue.clearCancellation(getApplicationContext(),id);return Result.success();
        }
        if(response.code==409){
            getApplicationContext().getSharedPreferences("connection",0).edit().putString("status","Item already published.").apply();
            Queue.remove(dir);Queue.clearCancellation(getApplicationContext(),id);return Result.success();
        }
        if(response.code==401||response.code==403){
            getApplicationContext().getSharedPreferences("connection",0).edit().putString("status","Pair this phone again to finish removing items.").apply();return Result.failure();
        }
        return Result.retry();
    }
}
