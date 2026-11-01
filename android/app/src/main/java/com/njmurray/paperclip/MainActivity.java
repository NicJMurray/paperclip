package com.njmurray.paperclip;

import android.app.Activity;
import android.os.*;
import android.graphics.Color;
import android.content.Intent;
import android.net.Uri;
import android.text.TextUtils;
import android.view.*;
import android.widget.*;
import java.io.File;
import java.util.*;
import org.json.*;

public class MainActivity extends Activity {
    private LinearLayout layout,queueRows;
    private TextView status,connectionStatus;
    private JSONArray remoteItems=new JSONArray();
    private int remoteTotal=0;
    private boolean remoteReady=false,remoteBusy=false,remoteFailed=false,pairingVisible=false;
    private long lastFetch=0;
    private String rowsSignature="";
    private final Set<String> dismissed=new HashSet<>();
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable refresh=new Runnable(){public void run(){showQueue();fetchQueue(false);handler.postDelayed(this,2000);}};
    private static class Waiting {
        final String id,label,note;final long time;
        Waiting(String id,String label,String note,long time){this.id=id;this.label=label;this.note=note;this.time=time;}
    }
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    @Override public void onCreate(Bundle state){super.onCreate(state);render();Queue.recover(getApplicationContext(),false);}
    @Override public void onResume(){super.onResume();handler.post(refresh);fetchQueue(true);}
    @Override public void onPause(){handler.removeCallbacks(refresh);super.onPause();}
    private TextView text(String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(Color.rgb(37,46,40));t.setPadding(0,dp(8),0,dp(8));layout.addView(t);return t;}
    private Button button(String label,Runnable action){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setOnClickListener(v->action.run());layout.addView(b,new LinearLayout.LayoutParams(-1,dp(54)));return b;}
    private void render(){
        ScrollView scroll=new ScrollView(this);layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(dp(28),dp(32),dp(28),dp(24));scroll.addView(layout);setContentView(scroll);
        if(Build.VERSION.SDK_INT>=30)scroll.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets i=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());v.setPadding(i.left,i.top,i.right,i.bottom);return insets;});
        else scroll.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});
        text("Paperclip",36);
        boolean connected=Settings.token(this)!=null;
        connectionStatus=text(connected?"Connected":"Not connected",14);
        text("Queue",20);status=text("",13);
        queueRows=new LinearLayout(this);queueRows.setOrientation(LinearLayout.VERTICAL);layout.addView(queueRows);rowsSignature="";
        pairingVisible=false;
        if(!connected)showPairing();
        else{
            button("Check connection",this::check);
            button("Retry uploads",()->{Queue.recover(getApplicationContext(),true);fetchQueue(true);showQueue();});
            button("Reconnect",this::showPairing);
        }
        button("Open collection",()->startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(Settings.ORIGIN))));
        text("Share → Paperclip. Offline uploads retry automatically.",13);
        text("× removes a waiting item. Changes sync when online.",13);
        showQueue();
    }
    private void showQueue(){
        if(status==null)return;
        Map<String,Waiting> merged=new HashMap<>();
        for(int i=0;i<remoteItems.length();i++){
            JSONObject item=remoteItems.optJSONObject(i);if(item==null)continue;String id=item.optString("id");
            if(dismissed.contains(id)||Queue.cancelled(this,id))continue;
            long time=0;try{time=java.time.Instant.parse(item.optString("created_at")).toEpochMilli();}catch(Exception ignored){}
            String url=item.optString("url","");if("null".equals(url))url="";
            merged.put(id,new Waiting(id,url.isEmpty()?item.optString("title","Image"):url,"held".equals(item.optString("status"))?"Held":"Waiting to sort",time));
        }
        for(File dir:Queue.entries(this)){
            String id=dir.getName();if(dismissed.contains(id))continue;
            try{
                JSONObject meta=new JSONObject(Queue.read(new File(dir,"meta.json")));
                merged.put(id,new Waiting(id,Queue.label(meta,new File(dir,"image").isFile()),new File(dir,"error").isFile()?"Upload needs retry":"Waiting to upload",Queue.createdAt(dir)));
            }catch(Exception e){merged.put(id,new Waiting(id,"Saved item","Upload needs retry",Queue.createdAt(dir)));}
        }
        ArrayList<Waiting> items=new ArrayList<>(merged.values());items.sort(Comparator.comparingLong((Waiting w)->w.time).reversed().thenComparing(w->w.id));
        String queueStatus;
        if(items.isEmpty())queueStatus=remoteReady?(remoteFailed?"Offline · last synced queue empty":"Queue empty"):Settings.token(this)==null?"Connect to see saved items":remoteFailed?"Offline":"Loading…";
        else queueStatus=(items.size()>3||remoteTotal>3?"Latest 3 waiting":items.size()+" waiting")+(remoteFailed?" · offline":"");
        status.setText(queueStatus);
        String last=getSharedPreferences("connection",0).getString("status","");if(!last.isEmpty())connectionStatus.setText(last);
        StringBuilder signature=new StringBuilder();for(int i=0;i<Math.min(3,items.size());i++){Waiting w=items.get(i);signature.append(w.id).append('\n').append(w.label).append('\n').append(w.note).append('\n');}
        if(signature.toString().equals(rowsSignature))return;rowsSignature=signature.toString();queueRows.removeAllViews();
        for(int i=0;i<Math.min(3,items.size());i++)addQueueRow(items.get(i));
    }
    private void addQueueRow(Waiting item){
        LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);row.setMinimumHeight(dp(64));row.setPadding(0,dp(5),0,dp(5));
        LinearLayout copy=new LinearLayout(this);copy.setOrientation(LinearLayout.VERTICAL);
        TextView label=new TextView(this);label.setText(item.label);label.setTextSize(14);label.setTextColor(Color.rgb(37,46,40));label.setMaxLines(2);label.setEllipsize(TextUtils.TruncateAt.END);copy.addView(label);
        TextView note=new TextView(this);note.setText(item.note);note.setTextSize(11);note.setTextColor(Color.rgb(116,120,111));note.setPadding(0,dp(3),0,0);copy.addView(note);
        row.addView(copy,new LinearLayout.LayoutParams(0,-2,1));
        Button remove=new Button(this,null,android.R.attr.borderlessButtonStyle);remove.setText("×");remove.setTextSize(24);remove.setTextColor(Color.rgb(116,120,111));remove.setPadding(0,0,0,0);remove.setMinimumWidth(0);remove.setContentDescription("Remove "+item.label);remove.setOnClickListener(v->remove(item));row.addView(remove,new LinearLayout.LayoutParams(dp(48),dp(48)));
        queueRows.addView(row);View line=new View(this);line.setBackgroundColor(Color.rgb(220,222,212));queueRows.addView(line,new LinearLayout.LayoutParams(-1,dp(1)));
    }
    private void remove(Waiting item){
        try{Queue.cancel(getApplicationContext(),item.id);dismissed.add(item.id);showQueue();Toast.makeText(this,"Removal queued",Toast.LENGTH_SHORT).show();}
        catch(Exception e){Toast.makeText(this,"Could not remove item. Try again.",Toast.LENGTH_SHORT).show();}
    }
    private void fetchQueue(boolean force){
        String token=Settings.token(this);long now=SystemClock.elapsedRealtime();
        if(token==null||remoteBusy||(!force&&now-lastFetch<5000))return;remoteBusy=true;lastFetch=now;
        new Thread(()->{
            Network.Response response=null;try{response=Network.queue(token);}catch(Exception ignored){}
            final Network.Response result=response;
            runOnUiThread(()->{
                remoteBusy=false;if(isFinishing()||isDestroyed())return;
                if(result!=null&&result.ok()&&result.body.optJSONArray("items")!=null){remoteItems=result.body.optJSONArray("items");remoteTotal=result.body.optInt("total");remoteReady=true;remoteFailed=false;}
                else{remoteFailed=true;if(result!=null&&result.code==401)getSharedPreferences("connection",0).edit().putString("status","Reconnect this phone").apply();}
                showQueue();
            });
        },"paperclip-queue").start();
    }
    private void showPairing(){
        if(pairingVisible)return;pairingVisible=true;
        text("Pairing code",14);EditText code=new EditText(this);code.setSingleLine(true);code.setHint("Paste pairing code");code.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);code.setAutofillHints((String[])null);layout.addView(code,new LinearLayout.LayoutParams(-1,dp(54)));
        button("Connect",()->{
            if(!code.isEnabled())return;String value=code.getText().toString().trim();if(value.isEmpty()){code.setError("Paste the pairing code first.");return;}code.setEnabled(false);
            new Thread(()->{
                String error=null;try{Network.Response r=Network.pair(value);if(!r.ok())throw new Exception(r.body.optString("error","Could not connect."));Settings.saveToken(this,r.body.getString("token"));Queue.recover(getApplicationContext(),true);}catch(Exception e){error=e.getMessage();}
                final String problem=error;runOnUiThread(()->{if(problem==null){getSharedPreferences("connection",0).edit().putString("status","Connected").apply();remoteReady=false;render();fetchQueue(true);}else{code.setEnabled(true);code.setError(problem);}});
            },"paperclip-pair").start();
        });
    }
    private void check(){new Thread(()->{
        String message;try{Network.Response response=Network.check(Settings.token(this));message=response.ok()?"Connected":response.body.optString("error","Reconnect this phone.");}catch(Exception e){message="Offline";}
        getSharedPreferences("connection",0).edit().putString("status",message).apply();runOnUiThread(()->{showQueue();fetchQueue(true);});
    },"paperclip-check").start();}
}
