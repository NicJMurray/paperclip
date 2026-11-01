package com.njmurray.paperclip;

import android.content.Context;
import android.view.*;
import android.widget.TextView;
import androidx.work.Configuration;
import androidx.work.testing.SynchronousExecutor;
import androidx.work.testing.WorkManagerTestInitHelper;
import java.io.File;
import java.util.*;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=35)
public class QueueTest {
    private Context context;
    @Before public void setup(){
        context=RuntimeEnvironment.getApplication();
        WorkManagerTestInitHelper.initializeTestWorkManager(context,new Configuration.Builder().setExecutor(new SynchronousExecutor()).build());
    }
    @After public void close(){WorkManagerTestInitHelper.closeWorkDatabase();}
    private File item(String id,String text,String title,long created)throws Exception{
        File dir=new File(Queue.root(context),id);assertTrue(dir.mkdir());
        Queue.write(new File(dir,"meta.json"),new JSONObject().put("id",id).put("text",text).put("title",title).put("created_at",created).toString());return dir;
    }
    private List<TextView> texts(View view){
        List<TextView> result=new ArrayList<>();if(view instanceof TextView)result.add((TextView)view);
        if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)result.addAll(texts(group.getChildAt(i)));}return result;
    }
    @Test public void urlsTakePriorityAndImageNamesRemainReadable()throws Exception{
        assertEquals("https://example.org/a",Queue.label(new JSONObject().put("text","Read https://example.org/a").put("title","A site icon"),true));
        assertEquals("sunset.png",Queue.label(new JSONObject().put("title","sunset.png"),true));
        assertEquals("Image",Queue.label(new JSONObject(),true));
    }
    @Test public void showsLatestThreeAndCrossRemovesOnlyTheSelectedItem()throws Exception{
        String[] ids=new String[4];for(int i=0;i<4;i++){ids[i]=UUID.randomUUID().toString();item(ids[i],"https://example.org/"+i,"",100+i);}
        try(ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class).setup()){
            View root=controller.get().getWindow().getDecorView();List<TextView> views=texts(root);
            assertEquals(3,views.stream().filter(v->v.getText().toString().startsWith("https://example.org/")).count());
            assertFalse(views.stream().anyMatch(v->v.getText().toString().equals("https://example.org/0")));
            View remove=views.stream().filter(v->"Remove https://example.org/3".contentEquals(v.getContentDescription()==null?"":v.getContentDescription())).findFirst().orElseThrow();
            assertTrue(remove.performClick());assertTrue(Queue.cancelled(context,ids[3]));
            assertEquals(3,Queue.entries(context).length);
            List<TextView> after=texts(root);assertFalse(after.stream().anyMatch(v->v.getText().toString().equals("https://example.org/3")));
            assertTrue(after.stream().anyMatch(v->v.getText().toString().equals("https://example.org/0")));
        }
    }
    @Test public void cancellationSurvivesOutboxCleanup()throws Exception{
        String id=UUID.randomUUID().toString();File dir=item(id,"https://example.org/a","",100);
        Queue.cancel(context,id);Queue.remove(dir);
        assertTrue(Queue.cancelled(context,id));assertEquals(0,Queue.entries(context).length);
        Queue.recover(context,false);assertTrue(Queue.cancelled(context,id));
    }
}
