override shadowDepthTextureSize: f32 = 1024.0;

struct Scene {
    cameraViewProjMatrix: mat4x4f,
    lightPos: vec3f,
    farPlane: f32,
}

@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var shadowMap: texture_depth_cube;
@group(0) @binding(2) var shadowSampler: sampler_comparison;

struct FragmentInput {
    @location(0) fragPos: vec3f,
    @location(1) fragNorm: vec3f,
}

const albedo = vec3f(0.9);
const ambientFactor = 0.2;

@fragment
fn main(input: FragmentInput) -> @location(0) vec4f {
    var lightToFragment = input.fragPos - scene.lightPos;
    // lightToFragment = vec3f(lightToFragment.x, -lightToFragment.y, lightToFragment.z);
    // let lightToFragment = -input.fragPos + scene.lightPos;
    let currentDepth = length(lightToFragment) / scene.farPlane;
    let bias = 0.5 / scene.farPlane;
    let offsetSize = length(lightToFragment) * 2.0 / shadowDepthTextureSize;

    var visibility = 0.0;
    for (var z = -1; z <= 1; z++) {
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let offset = vec3f(vec3(x, y, z)) * offsetSize;

                visibility += textureSampleCompare(
                    shadowMap, shadowSampler,
                    lightToFragment + offset, currentDepth - bias
                );
            }
        }
    }
    visibility /= 27.0;
    // visibility = textureSampleCompare(
    //     shadowMap,
    //     shadowSampler,
    //     lightToFragment,
    //     currentDepth - bias
    // );

    let lambertFactor = max(dot(normalize(scene.lightPos - input.fragPos), normalize(input.fragNorm)), 0.0);
    let lightingFactor = min(ambientFactor + visibility * lambertFactor, 1.0);

    return vec4(lightingFactor * albedo, 1.0);
    // return vec4(visibility, visibility, visibility, 1.0);
}
