using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Threading;
using LibVLCSharp.Shared;
using Tonarium.Desktop.Media;
AppBuilder.Configure<Tonarium.Desktop.App>().UsePlatformDetect().SetupWithoutStarting();
var exit=1;
Dispatcher.UIThread.Post(async()=>{try {await Run(args);exit=0;}catch(Exception ex){Console.WriteLine(ex);}finally{Dispatcher.UIThread.InvokeShutdown();}});
Dispatcher.UIThread.MainLoop(CancellationToken.None);return exit;
static async Task Run(string[] args){
 var fixture=Path.GetFullPath(args.ElementAtOrDefault(0) ?? "native/verification/item-behavior/red-blue-4s.mp4");
 var type=typeof(NativeMedia).Assembly.GetType("Tonarium.Desktop.Views.NativeVideoView")!;
 var actions=new List<string>();var view=Activator.CreateInstance(type,fixture,new Action<object>(x=>actions.Add(System.Text.Json.JsonSerializer.Serialize(x))))!;
 object? Field(string n)=>type.GetField(n,BindingFlags.NonPublic|BindingFlags.Instance)!.GetValue(view);
 var player=(MediaPlayer)Field("player")!;
 type.GetField("surfaceLoaded",BindingFlags.NonPublic|BindingFlags.Instance)!.SetValue(view,true);
 var update=type.GetMethod("UpdateClock")!;
 void Clock(double position,bool playing)=>update.Invoke(view,new object[]{new JsonObject{["base"]=position,["at"]=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),["playing"]=playing},0L});
 int frames=0,red=0,blue=0;
 var pixels=Marshal.AllocHGlobal(640*360*4);
 MediaPlayer.LibVLCVideoLockCb onLock=(opaque,planes)=>{Marshal.WriteIntPtr(planes,pixels);return IntPtr.Zero;};
 MediaPlayer.LibVLCVideoDisplayCb onDisplay=(opaque,picture)=>{var p=pixels+(180*640+320)*4;var b=Marshal.ReadByte(p);var r=Marshal.ReadByte(p+2);if(r>180&&b<60)Interlocked.Increment(ref red);if(b>180&&r<60)Interlocked.Increment(ref blue);Interlocked.Increment(ref frames);};
 player.SetVideoFormat("RV32",640,360,640*4);player.SetVideoCallbacks(onLock,null,onDisplay);
 try{
  Clock(0,false);player.Play();await Until(()=>frames>0,"first decoded frame");
  Clock(0,true);await Until(()=>player.Time>350,"playing timeline");
  Clock(.8,false);await Until(()=>!player.IsPlaying&&Math.Abs(player.Time-800)<180,"pause at .8s");
  var paused=player.Time;await Task.Delay(350);if(Math.Abs(player.Time-paused)>80)throw new Exception("Paused clock advanced");
  Clock(1.2,false);await Until(()=>Math.Abs(player.Time-1200)<150,"explicit short .4s seek while paused");
  var shortSeek=player.Time;
  Clock(1.8,true);await Until(()=>blue>0,"blue frames after 2s color change");
  Clock(3.7,true);await Task.Delay(650);Clock(4.4,true);
  var toggle=(Button)Field("toggle")!;toggle.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
  if(!actions.Any(a=>a.Contains("mediaPlay")&&a.Contains("\"pos\":0")))throw new Exception("End replay did not request position zero");
  var result=new JsonObject{["status"]="pass",["fixture"]=fixture,["decodedFrames"]=frames,["redFrames"]=red,["blueFrames"]=blue,["pausedTimeMs"]=paused,["shortSeekTimeMs"]=shortSeek,["shortSeekDeltaMs"]=400,["endReplay"]=true,["physicalDevicesUsed"]=false};
  var output=Path.GetFullPath(args.ElementAtOrDefault(1) ?? "native/artifacts/video-smoke.json");Directory.CreateDirectory(Path.GetDirectoryName(output)!);File.WriteAllText(output,result.ToJsonString());Console.WriteLine(result.ToJsonString());
 }finally{((IDisposable)view).Dispose();Marshal.FreeHGlobal(pixels);GC.KeepAlive(onLock);GC.KeepAlive(onDisplay);}
}
static async Task Until(Func<bool> ready,string step){var stop=DateTime.UtcNow.AddSeconds(7);while(DateTime.UtcNow<stop){if(ready())return;await Task.Delay(40);}throw new Exception("Timed out: "+step);}
