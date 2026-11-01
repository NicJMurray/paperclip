package com.njmurray.paperclip;

import android.app.Activity;
import android.os.*;
import android.graphics.Color;
import android.content.Intent;
import android.net.Uri;
import android.view.*;
import android.widget.*;
import java.io.File;

public class MainActivity extends Activity {
    private LinearLayout layout;private TextView status;private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable refresh=new Runnable(){public void run(){showQueue();handler.postDelayed(this,2000);}};
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    @Override public void onCreate(Bundle state){super.onCreate(state);render();Queue.recover(getApplicationContext(),false);}
    @Override public void onResume(){super.onResume();handler.post(refresh);}
    @Override public void onPause(){handler.removeCallbacks(refresh);super.onPause();}
    private TextView text(String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(Color.rgb(37,46,40));t.setPadding(0,dp(8),0,dp(8));layout.addView(t);return t;}
    private Button button(String label,Runnable action){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setOnClickListener(v->action.run());layout.addView(b,new LinearLayout.LayoutParams(-1,dp(54)));return b;}
    private void render(){
        ScrollView scroll=new ScrollView(this);layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(dp(28),dp(48),dp(28),dp(28));scroll.addView(layout);setContentView(scroll);
        // Target SDK 35 draws edge-to-edge. Respect status bars, navigation and keyboard.
        if(Build.VERSION.SDK_INT>=30)scroll.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets i=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());v.setPadding(i.left,i.top,i.right,i.bottom);return insets;});
        else scroll.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});
        text("Paperclip",36);text("Share it. Keep going.",18);
        boolean connected=Settings.token(this)!=null;
        text(connected?"This phone is connected. Choose Paperclip from any app’s share menu to save a link, text or image. There is no confirmation screen.":"One-time setup: paste your pairing code below. After that, just share to Paperclip.",15);
        status=text("",14);
        if(!connected){showPairing();}else{
            button("Check connection",()->check());
            button("Retry uploads",()->{Queue.recover(getApplicationContext(),true);showQueue();});
            button("Pair this phone again",()->showPairing());
        }
        button("Open the collection ↗",()->startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(Settings.ORIGIN))));
        text("To keep Paperclip handy, long-press its icon in Android’s share sheet and choose Pin, if your phone offers it. Android decides the order.",13);
        text("Saved items stay on this phone until upload is confirmed. Offline uploads retry automatically. The public collection is sorted once a week. Images up to 10 MB; multiple images are supported.",13);
        text("Queued items become public after sorting. Avoid saving private information you don’t want published.",13);
        showQueue();
    }
    private void showQueue(){
        if(status==null)return;File[] entries=Queue.entries(this);int errors=0;String problem="";
        for(File dir:entries){File error=new File(dir,"error");if(error.isFile()){errors++;try{problem=Queue.read(error);}catch(Exception ignored){}}}
        String last=getSharedPreferences("connection",0).getString("status","");
        status.setText(entries.length==0?(last.isEmpty()?"Nothing waiting to upload.":last):entries.length+" waiting to upload."+(errors>0?"\n"+problem:"\nWill upload when connected."));
    }
    private void showPairing(){
        text("Pairing code",14);EditText code=new EditText(this);code.setSingleLine(true);code.setHint("Paste your 32-character code");code.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);code.setAutofillHints((String[])null);layout.addView(code,new LinearLayout.LayoutParams(-1,dp(54)));
        Button pair=button("Connect Paperclip",()->{
            String value=code.getText().toString().trim();if(value.isEmpty()){code.setError("Paste the pairing code first.");return;}
            code.setEnabled(false);
            new Thread(()->{
                String error=null;try{Network.Response r=Network.pair(value);if(!r.ok())throw new Exception(r.body.optString("error","Could not connect."));Settings.saveToken(this,r.body.getString("token"));Queue.recover(getApplicationContext(),true);}catch(Exception e){error=e.getMessage();}
                final String problem=error;runOnUiThread(()->{if(problem==null){getSharedPreferences("connection",0).edit().putString("status","Connected. Ready to save.").apply();render();}else{code.setEnabled(true);code.setError(problem);}});
            },"paperclip-pair").start();
        });
    }
    private void check(){new Thread(()->{
        String message;try{Network.Response response=Network.check(Settings.token(this));message=response.ok()?"Connected. Ready to save.":response.body.optString("error","Pair this phone again.");}catch(Exception e){message="Could not reach Paperclip. Your queued items are safe on this phone.";}
        getSharedPreferences("connection",0).edit().putString("status",message).apply();runOnUiThread(this::showQueue);
    },"paperclip-check").start();}
}
