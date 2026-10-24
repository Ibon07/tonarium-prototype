Shader "Tonarium/SurvivorEffect"
{
    Properties { _Color ("Color", Color) = (1,1,1,1) _DstBlend ("Destination blend", Float) = 10 }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" }
        Lighting Off Cull Off ZWrite Off ZTest LEqual
        Blend SrcAlpha [_DstBlend]
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            struct v2f { float4 position : SV_POSITION; };
            fixed4 _Color;
            v2f vert(float4 vertex : POSITION) { v2f o; o.position=UnityObjectToClipPos(vertex); return o; }
            fixed4 frag(v2f i) : SV_Target { return _Color; }
            ENDCG
        }
    }
}
