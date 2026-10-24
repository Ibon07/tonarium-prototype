using System.Diagnostics;
using System.Text.Json.Nodes;
using NAudio.Wave;

namespace Tonarium.Desktop.Media;

/// <summary>Web と同じ状態差分・生成レシピを、2D と Unity 共通で再生する。</summary>
internal sealed class SurvivorAudio : IDisposable
{
    private readonly object gate = new();
    private readonly PcmMixer mixer = new();
    private NativeAudioOutput? output;
    private bool disposed;
    private long lastAttack;
    private static readonly Dictionary<string, float[]> cache = new();
    internal static readonly JsonObject Recipes = JsonNode.Parse(typeof(SurvivorAudio).Assembly.GetManifestResourceStream("Tonarium.SurvivorAudio.json")!)!.AsObject();

    internal static IEnumerable<(string Kind, string Gear)> Transitions(JsonObject previous, JsonObject next)
    {
        string Text(JsonNode? n, string k) => n?[k]?.ToString() ?? "";
        if (previous.Count == 0 || Text(previous, "run") != Text(next, "run"))
        {
            if (Text(next, "phase") == "running") yield return ("start", "");
            yield break;
        }
        var oldEffects = (previous["effects"] as JsonArray ?? []).Select(e => Text(e,"id")).ToHashSet();
        var fresh = (next["effects"] as JsonArray ?? []).Where(e => !oldEffects.Contains(Text(e,"id"))).LastOrDefault();
        if (fresh is not null) yield return ("attack", Text(fresh,"gear"));
        var before = previous["players"] as JsonObject ?? new();
        var players = next["players"] as JsonObject ?? new();
        if (players.Any(p => before[p.Key] is JsonObject old && (p.Value?["level"]?.GetValue<int>() ?? 0) > (old["level"]?.GetValue<int>() ?? 0))) yield return ("level", "");
        else if (players.Any(p => before[p.Key] is JsonObject old && (p.Value?["gear"] as JsonObject ?? new()).Any(g => (g.Value?.GetValue<int>() ?? 0) != (old["gear"]?[g.Key]?.GetValue<int>() ?? 0)))) yield return ("equip", "");
        if (Text(previous,"phase") != "boss" && Text(next,"phase") == "boss") yield return ("boss", "");
        if (Text(previous,"phase") != "ended" && Text(next,"phase") == "ended") yield return (next["bossDefeated"]?.GetValue<bool>() == true ? "victory" : "end", "");
        if (previous["pausedAt"] is null && next["pausedAt"] is not null) yield return ("pause", "");
        else if (previous["pausedAt"] is not null && next["pausedAt"] is null && Text(next,"phase") is "running" or "boss") yield return ("resume", "");
    }

    public void Apply(JsonObject previous, JsonObject next, double volume)
    {
        if (volume <= .001) return;
        foreach (var (kind, gear) in Transitions(previous, next))
        {
            if (kind == "attack")
            {
                var now = Stopwatch.GetTimestamp();
                if (Stopwatch.GetElapsedTime(lastAttack, now).TotalMilliseconds < 90) continue;
                lastAttack = now;
            }
            var key = kind == "attack" ? "attack:" + gear : kind;
            if (!Recipes.ContainsKey(key)) key = "attack:default";
            var gain = (float)Math.Clamp(volume, 0, 1);
            _ = Task.Run(() =>
            {
                try
                {
                    float[] pcm;
                    lock (cache) { if (!cache.TryGetValue(key, out pcm!)) cache[key] = pcm = Synthesize(Recipes[key]!.AsArray()); }
                    lock (gate)
                    {
                        if (disposed) return;
                        output ??= new NativeAudioOutput(mixer, null);
                        mixer.Add(pcm, gain);
                    }
                }
                catch (Exception ex) { Program.Log("Survivor audio: " + ex.Message); }
            });
        }
    }

    internal static float[] Synthesize(JsonArray voices, int rate = 48000)
    {
        double N(JsonNode v, string key) => v[key]?.GetValue<double>() ?? 0;
        var samples = new float[(int)Math.Ceiling(voices.Max(v => N(v!,"at") + N(v!,"duration") + .02) * rate)];
        var random = new Random(71239);
        foreach (var voice in voices)
        {
            var v = voice!; var wave = v["wave"]!.ToString();
            var duration = N(v,"duration"); var gain = N(v,"volume");
            var start = N(v,"start"); var end = Math.Max(1,N(v,"end"));
            var at = (int)(N(v,"at")*rate); var count = (int)(duration*rate);
            var ramp = wave == "noise" ? 0 : Math.Log(end/start)/duration;
            double phase = 0, x1=0,x2=0,y1=0,y2=0;
            // WebAudio BiquadFilter lowpass (既定 Q=1)。
            var w = 2*Math.PI*N(v,"cutoff")/rate; var cos = Math.Cos(w); var alpha=Math.Sin(w)/2;
            var b0=(1-cos)/2/(1+alpha); var b1=(1-cos)/(1+alpha); var b2=b0;
            var a1=-2*cos/(1+alpha); var a2=(1-alpha)/(1+alpha);
            for (var i=0;i<count;i++)
            {
                var t=(double)i/rate;
                double value;
                if (wave == "noise")
                {
                    var x=(random.NextDouble()*2-1)*Math.Pow(1-(double)i/count,2);
                    value=b0*x+b1*x1+b2*x2-a1*y1-a2*y2; x2=x1; x1=x; y2=y1; y1=value;
                }
                else
                {
                    // 加算合成で Nyquist 超過を除き、WebAudio 同様に帯域制限する。
                    var frequency=start*Math.Exp(ramp*t);
                    value=Math.Sin(phase);
                    if (wave is "triangle" or "sawtooth")
                    {
                        value=0; var harmonics=Math.Min(96,(int)(rate*.5/frequency));
                        for(var h=1;h<=harmonics;h += wave=="triangle" ? 2 : 1)
                            value += wave=="triangle" ? 8/Math.Pow(Math.PI,2)*Math.Pow(-1,(h-1)/2)*Math.Sin(h*phase)/(h*h) : 2/Math.PI*Math.Pow(-1,h+1)*Math.Sin(h*phase)/h;
                    }
                    phase += 2*Math.PI*frequency/rate;
                }
                samples[at+i] += (float)(value*gain*Math.Pow(.0001/gain,t/duration));
            }
        }
        return samples;
    }

    public void Dispose() { lock(gate) { disposed=true; output?.Dispose(); output=null; } }

    private sealed class PcmMixer : IWaveProvider
    {
        private readonly object gate=new();
        private readonly List<(float[] Pcm, int At, float Gain)> voices=[];
        public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(48000,1);
        public void Add(float[] pcm,float gain) { lock(gate) { if(voices.Count<32) voices.Add((pcm,0,gain)); } }
        public int Read(byte[] buffer,int offset,int count)
        {
            Array.Clear(buffer,offset,count);
            lock(gate)
            {
                for(var frame=0;frame<count/4;frame++)
                {
                    float sum=0;
                    for(var i=voices.Count-1;i>=0;i--)
                    {
                        var voice=voices[i]; sum+=voice.Pcm[voice.At++]*voice.Gain;
                        if(voice.At==voice.Pcm.Length) voices.RemoveAt(i); else voices[i]=voice;
                    }
                    BitConverter.TryWriteBytes(buffer.AsSpan(offset+frame*4,4),Math.Clamp(sum,-1,1));
                }
            }
            return count;
        }
    }
}
