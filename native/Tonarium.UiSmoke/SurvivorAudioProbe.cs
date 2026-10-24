using System.Text.Json.Nodes;
using Tonarium.Desktop.Media;

internal static class SurvivorAudioProbe
{
    internal static void Run(Action<string> pass)
    {
        JsonObject State(string phase="running",int level=1,int gear=1,bool paused=false) => new()
        {
            ["run"]=1,["phase"]=phase,["pausedAt"]=paused ? 100 : null,
            ["players"]=new JsonObject { ["p"]=new JsonObject { ["level"]=level,["gear"]=new JsonObject { ["starbolt"]=gear } } },
            ["effects"]=new JsonArray()
        };
        void Expect(JsonObject before, JsonObject next, params string[] expected)
        {
            var actual=SurvivorAudio.Transitions(before,next).Select(v=>v.Kind).ToArray();
            if(!actual.SequenceEqual(expected)) throw new Exception($"Audio transition: {string.Join(',',actual)} != {string.Join(',',expected)}");
        }
        Expect(new(),State(),"start"); Expect(new(),State("boss")); Expect(State(),State());
        var next=State(); next["effects"]=new JsonArray(new JsonObject { ["id"]="a",["gear"]="shade" });
        Expect(State(),next,"attack"); Expect(next,(JsonObject)next.DeepClone());
        if(SurvivorAudio.Transitions(State(),next).Single().Gear!="shade") throw new Exception("Attack gear lost");
        pass("Audio: initial run and fresh effect IDs match Web, no replay");
        Expect(State(),State(level:2,gear:2,paused:true),"level","pause");
        Expect(State(),State(gear:2),"equip"); Expect(State(paused:true),State(),"resume");
        Expect(State(),State("boss"),"boss"); Expect(State("boss"),State("ended"),"end");
        next=State("ended"); next["bossDefeated"]=true; Expect(State("boss"),next,"victory");
        pass("Audio: level/equip precedence, boss, pause/resume and both endings match Web");
        if(SurvivorAudio.Recipes.Count != 16) throw new Exception("Missing Web sound recipes");
        foreach(var (key,recipe) in SurvivorAudio.Recipes)
        {
            var pcm=SurvivorAudio.Synthesize(recipe!.AsArray());
            if(pcm.Any(v=>!float.IsFinite(v)) || !pcm.Any(v=>Math.Abs(v)>.005) || pcm.Max(v=>Math.Abs(v))>1) throw new Exception("Invalid PCM: "+key);
            if(pcm.Take(500).Any(v=>v!=0)) throw new Exception("Web scheduled onset lost: "+key);
        }
        pass("Audio: all 16 Web-generated recipes produce finite non-silent PCM without clipping");
        var a=SurvivorAudio.Synthesize(SurvivorAudio.Recipes["attack:starbolt"]!.AsArray());
        var b=SurvivorAudio.Synthesize(SurvivorAudio.Recipes["attack:shade"]!.AsArray());
        if(a.SequenceEqual(b)) throw new Exception("Weapon sound distinction lost");
        pass("Audio: weapon-specific sound synthesis differs");
    }
}
