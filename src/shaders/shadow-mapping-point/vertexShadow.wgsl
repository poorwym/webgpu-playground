struct Scene {
    lightViewProjMatrix: mat4x4f,
    lightPos: vec3f,
    farPlane: f32,
}

struct Model {
    modelMatrix: mat4x4f,
}

@group(0) @binding(0) var<uniform> scene: Scene;
@group(1) @binding(0) var<uniform> model: Model;

struct VertexOutput {
    @location(0) worldPos: vec3f,
    @builtin(position) Position: vec4f,
}

@vertex
fn main(
    @location(0) position: vec3f
) -> VertexOutput {
    let worldPosition = model.modelMatrix * vec4(position, 1.0);

    var output: VertexOutput;
    output.worldPos = worldPosition.xyz;
    output.Position = scene.lightViewProjMatrix * worldPosition;
    return output;
}
