# Shared Web assets

Brand images are linked from `client/public/brand/`. `favicon.ico` wraps that folder's original 64×64 PNG as a Windows icon without changing its pixels. `Views/WebIcon.cs` uses the SVG geometry from `client/src/world/Icon.tsx`.

The original Web fonts are bundled for offline rendering:

- [Zen Kaku Gothic New](https://github.com/google/fonts/tree/main/ofl/zenkakugothicnew)
- [Zen Maru Gothic](https://github.com/google/fonts/tree/main/ofl/zenmarugothic)

Each font's SIL Open Font License is in `fonts/` and copied to the published application's `licenses/` directory.

Oekaki model provenance and permission are recorded in `../../Tonarium.Unity/Assets/Resources/OekakiSource.md`. The desktop client embeds the same decoded model data and sample texture as Unity.
