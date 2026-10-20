using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Tonarium.UnityClient
{
    // 計測自体による停止を避け、入力中は配列へ記録し、終了時だけファイルへ保存する。
    [DefaultExecutionOrder(32000)]
    public sealed class InputDiagnostics : MonoBehaviour
    {
        struct Sample
        {
            public double Time;
            public float FrameMs, X, Y;
            public float UsedX, UsedY;
            public int Locked, Collections;
            public bool Relative;
        }
        readonly Sample[] samples = new Sample[36000];
        int count;
        string output;
        TonariumWorld world;

        void Awake() { output = Environment.GetEnvironmentVariable("TONARIUM_INPUT_DIAGNOSTICS");world=GetComponent<TonariumWorld>(); }
        void LateUpdate()
        {
            if(count >= samples.Length)return;
            samples[count++]=new Sample {Time=Time.realtimeSinceStartupAsDouble,FrameMs=Time.unscaledDeltaTime*1000,
                X=Input.GetAxisRaw("Mouse X"),Y=Input.GetAxisRaw("Mouse Y"),Locked=Cursor.lockState==CursorLockMode.Locked?1:0,
                UsedX=world.PointerDelta.x,UsedY=world.PointerDelta.y,Relative=world.RelativePointerActive,Collections=GC.CollectionCount(0)};
        }
        void OnDestroy()
        {
            if(string.IsNullOrEmpty(output)||count==0)return;
            try
            {
                var path=Path.ChangeExtension(output,"unity.csv");Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
                var csv=new StringBuilder("seconds,frameMs,mouseX,mouseY,locked,gcCount,usedX,usedY,relative\n");
                foreach(var s in samples.Take(count))csv.AppendFormat(CultureInfo.InvariantCulture,"{0:F6},{1:F4},{2:F4},{3:F4},{4},{5},{6:F4},{7:F4},{8}\n",s.Time,s.FrameMs,s.X,s.Y,s.Locked,s.Collections,s.UsedX,s.UsedY,s.Relative);
                File.WriteAllText(path,csv.ToString());
                var locked=samples.Take(count).Where(s=>s.Locked==1&&s.Time>2).ToArray();
                var times=locked.Select(s=>s.FrameMs).OrderBy(v=>v).ToArray();
                File.WriteAllText(Path.ChangeExtension(output,"unity.json"),Newtonsoft.Json.JsonConvert.SerializeObject(new Summary {
                    frames=count,lockedFrames=locked.Length,mouseFrames=locked.Count(s=>s.X!=0||s.Y!=0),relativeFrames=locked.Count(s=>s.Relative),usedMouseFrames=locked.Count(s=>s.UsedX!=0||s.UsedY!=0),
                    packets=world.PointerPackets,inputError=world.PointerError,
                    medianMs=Percentile(times,.5),p95Ms=Percentile(times,.95),p99Ms=Percentile(times,.99),maxMs=times.Length==0?0:times[times.Length-1],
                    over33Ms=times.Count(t=>t>33.34f),over50Ms=times.Count(t=>t>50),collections=count>0?samples[count-1].Collections-samples[0].Collections:0
                },Newtonsoft.Json.Formatting.Indented));
            }
            catch(Exception error){Debug.LogWarning("Input diagnostics: "+error.Message);}
        }
        static float Percentile(float[] values,double p)=>values.Length==0?0:values[Math.Min(values.Length-1,(int)(values.Length*p))];
        [Serializable] struct Summary
        {
            public int frames,lockedFrames,mouseFrames,relativeFrames,usedMouseFrames,over33Ms,over50Ms,collections;
            public long packets;
            public string inputError;
            public float medianMs,p95Ms,p99Ms,maxMs;
        }
    }
}
