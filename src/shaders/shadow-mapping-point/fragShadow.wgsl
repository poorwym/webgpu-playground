struct Scene {
    lightViewProjMatrix: mat4x4f,
    lightPos: vec3f,
    farPlane: f32,
}

@group(0) @binding(0) var<uniform> scene: Scene;

struct FragmentInput {
    @location(0) worldPos: vec3f,
}

@fragment
fn main(input: FragmentInput) -> @builtin(frag_depth) f32 {
    return min(length(input.worldPos - scene.lightPos) / scene.farPlane, 1.0);
}
