@group(0) @binding(0) var<uniform> viewDirectionProjectionInverse: mat4x4f;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var myTexture: texture_cube<f32>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(1) direction: vec4f,
};

@vertex
fn mainVS(
    @builtin(vertex_index) vertexIndex: u32
) -> VertexOutput {
    // A triangle large enough to cover all of clip space.
    let pos = array(
        vec2f(-1, -1),
        vec2f(-1, 3),
        vec2f(3, -1),
    );
    let p = pos[vertexIndex];
    // We return the position twice. Once for @builtin(position)
    // Once for the fragment shader. The values in the fragment shader
    // will go from -1,-1 to 1,1 across the entire texture.
    return VertexOutput(
        vec4f(p, 0, 1),
        vec4f(p, 1, 1),
    );
}

@fragment
fn mainFS(
    in: VertexOutput,
) -> @location(0) vec4f {
    // orient the direction to the view
    let t = viewDirectionProjectionInverse * in.direction;
    // remove the perspective.
    let uvw = normalize(t.xyz / t.w);
    return textureSample(myTexture, mySampler, uvw);
}

// ================================
// ❌ WRONG VERSION (vertex 计算方向)
// ================================
// @group(0) @binding(0) var<uniform> viewDirectionProjectionInverse: mat4x4f;
// @group(0) @binding(1) var mySampler: sampler;
// @group(0) @binding(2) var myTexture: texture_cube<f32>;
//
// struct VSOut {
//     @builtin(position) position: vec4f,
//     @location(0) direction: vec3f,
// };
//
// @vertex
// fn mainVS(
//     @builtin(vertex_index) vertexIndex: u32
// ) -> VSOut {
//
//     // 全屏三角形
//     let pos = array(
//         vec2f(-1.0, -1.0),
//         vec2f(-1.0, 3.0),
//         vec2f(3.0, -1.0),
//     );
//
//     let p = pos[vertexIndex];
//
//     // clip space 点
//     let clip = vec4f(p, 1.0, 1.0);
//
//     // ❌ 在 vertex 做反投影
//     let t = viewDirectionProjectionInverse * clip;
//
//     // ❌ 在 vertex 做 perspective divide
//     let dir = normalize(t.xyz / t.w);
//
//     return VSOut(
//         vec4f(p, 0.0, 1.0),
//         dir
//     );
// }
//
// @fragment
// fn mainFS(
//     in: VSOut
// ) -> @location(0) vec4f {
//
//     // ⚠️ 这里拿到的是“插值后的 direction”
//     let uvw = normalize(in.direction);
//
//     return textureSample(myTexture, mySampler, uvw);
// }
