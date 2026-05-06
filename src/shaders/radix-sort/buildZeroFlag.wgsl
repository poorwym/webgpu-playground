struct Params {
  count: u32,
  bit: u32,
}

@group(0) @binding(0) var<storage, read> values: array<u32>;
@group(0) @binding(1) var<storage, read_write> zero_flags: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;

  if (index >= params.count) {
    return;
  }

  let mask = 1u << params.bit;
  zero_flags[index] = select(0u, 1u, (values[index] & mask) == 0u);
}
