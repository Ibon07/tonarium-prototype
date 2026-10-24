using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;
namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        readonly Dictionary<string,JObject> activeEmotes=new Dictionary<string,JObject>();
        void ReceiveEmote(JObject message)
        {
            string id=(string)message["id"],from=(string)message["from"];
            if(string.IsNullOrEmpty(id)||string.IsNullOrEmpty(from)||WorldCatalog["emotes"][id]==null)return;
            if((string)message["sid"]!=sessionId)return;
            double at=(double?)message["at"]??double.NaN;
            if(double.IsNaN(at)||double.IsInfinity(at))return;
            if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+serverOffset-at >= (double)WorldCatalog["emotes"][id]["duration"])return;
            if(activeEmotes.TryGetValue(from,out var previous)&&(double)previous["at"]>=at)return;
            activeEmotes[from]=(JObject)message.DeepClone();
            if(avatars.TryGetValue(from,out var avatar))
            {
                var model=avatar.GetComponentInChildren<OekakiModel>();
                if(model!=null){model.EmoteId=id;model.EmoteDuration=(float)WorldCatalog["emotes"][id]["duration"];model.EmoteStarted=Time.unscaledTime-(float)Math.Max(0,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+serverOffset-at)/1000;}
            }
        }
        void DrawEmotes()
        {
            double now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+serverOffset;
            foreach(var pair in activeEmotes.ToArray())
            {
                var definition=WorldCatalog["emotes"][(string)pair.Value["id"]];
                if(now-(double)pair.Value["at"] >= (double)definition["duration"]){activeEmotes.Remove(pair.Key);continue;}
                Vector3 screen;
                if(pair.Key==selfId)screen=new Vector3(Screen.width/2,Screen.height*.8f,1);
                else if(avatars.TryGetValue(pair.Key,out var avatar))screen=eye.WorldToScreenPoint(avatar.transform.position+Vector3.up*1.9f);
                else continue;
                if(screen.z<=0)continue;
                var style=new GUIStyle(bodyStyle){alignment=TextAnchor.MiddleCenter,normal={textColor=ColorValue((string)definition["color"])}};
                var rect=new Rect(screen.x/uiScale-65,(Screen.height-screen.y)/uiScale-30,130,32);
                HudPanel(rect,(string)definition["tint"]);GUI.Label(rect,(string)definition["caption"],style);
            }
        }
    }
}
