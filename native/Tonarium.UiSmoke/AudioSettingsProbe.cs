using System.Reflection;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;
using Tonarium.Desktop.Views;

internal static class AudioSettingsProbe
{
    internal static async Task Run(string output, Action<string> pass)
    {
        using var preferences = DesktopInstance.Acquire(Path.Combine(output, "preferences"));
        NativeSettings.SetBool("microphoneEnabled", false);
        NativeSettings.SetString("microphoneDevice", ""); NativeSettings.SetString("speakerDevice", "");
        var window = new MainWindow();
        try
        {
            window.Show();
            typeof(MainWindow).GetMethod("LoadDemo", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(window, null);
            await Tick();
            Button Find(string name, Control root) => root.GetVisualDescendants().OfType<Button>().First(b => b.Content as string == name || AutomationProperties.GetName(b) == name);
            void Click(string name, Control root) => Find(name, root).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            Click("音声設定", window); await Tick();
            var dialog = window.OwnedWindows.Single(w => w.Title == "音声設定");
            var mic = dialog.GetVisualDescendants().OfType<ComboBox>().Single(c => c.Name == "MicrophoneDevice");
            var speaker = dialog.GetVisualDescendants().OfType<ComboBox>().Single(c => c.Name == "SpeakerDevice");
            if (mic.ItemCount < 1 || speaker.ItemCount < 1 || mic.SelectedIndex != 0 || speaker.SelectedIndex != 0) throw new Exception("Default audio device selection missing");
            pass("Home audio settings opens on its owner with default input/output selections");
            mic.SelectedIndex = mic.ItemCount > 1 ? 1 : 0; speaker.SelectedIndex = speaker.ItemCount > 1 ? 1 : 0;
            string DeviceId(ComboBox box) => box.SelectedItem?.GetType().GetProperty("Id")?.GetValue(box.SelectedItem) as string ?? "";
            var microphoneId = DeviceId(mic); var speakerId = DeviceId(speaker);
            Click("機器を再読み込み", dialog); await Tick();
            if (DeviceId(mic) != microphoneId || DeviceId(speaker) != speakerId) throw new Exception("Device refresh lost selection");
            using (var frame = dialog.CaptureRenderedFrame()) frame!.Save(Path.Combine(output, "audio-settings.png"));
            Click("適用", dialog); await Tick();
            if (window.OwnedWindows.Contains(dialog) || NativeSettings.GetString("microphoneDevice") != microphoneId || NativeSettings.GetString("speakerDevice") != speakerId || NativeSettings.GetBool("microphoneEnabled")) throw new Exception("Audio selection was not saved with mute preserved");
            pass("Device refresh retains selections and Apply saves both devices without enabling the microphone");
            Click("音声設定", window); await Tick();
            dialog = window.OwnedWindows.Single(w => w.Title == "音声設定");
            mic = dialog.GetVisualDescendants().OfType<ComboBox>().Single(c => c.Name == "MicrophoneDevice");
            if (DeviceId(mic) != microphoneId) throw new Exception("Reopening lost saved microphone");
            mic.SelectedIndex = 0; Click("キャンセル", dialog); await Tick();
            if (NativeSettings.GetString("microphoneDevice") != microphoneId) throw new Exception("Cancel changed microphone preference");
            pass("Reopening restores the selected microphone; Cancel preserves it");
            await using var client = new TonariumClient(new ClientState(), persistSettings: false);
            await using var media = new NativeMedia(client);
            var restored = typeof(NativeMedia).GetField("microphoneDevice", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(media) as string ?? "";
            if (restored != microphoneId) throw new Exception("A new media session lost the saved microphone");
            var overlayOwner = new Window { Title = "3D overlay owner", Width = 900, Height = 600 }; overlayOwner.Show();
            var pending = media.ShowAudioSettingsAsync(overlayOwner); await Tick();
            dialog = overlayOwner.OwnedWindows.Single(w => w.Title == "音声設定");
            Click("キャンセル", dialog); await pending; overlayOwner.Close();
            pass("New media sessions restore saved input and audio settings use the explicit 3D overlay owner");
        }
        finally { foreach (var child in window.OwnedWindows.ToArray()) child.Close(); window.Close(); }
    }
    static async Task Tick() { await Task.Delay(250); AvaloniaHeadlessPlatform.ForceRenderTimerTick(3); }
}
