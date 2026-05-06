struct Params {
  count: u32,
  bit: u32,
}

@group(0) @binding(0) var<storage, read> input_values: array<u32>;
@group(0) @binding(1) var<storage, read> zero_flags: array<u32>;
@group(0) @binding(2) var<storage, read> zero_prefix: array<u32>;
@group(0) @binding(3) var<storage, read> metadata: array<u32>;
@group(0) @binding(4) var<storage, read_write> output_values: array<u32>;
@group(0) @binding(5) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;

  if (index >= params.count) {
    return;
  }

  let zero_count = metadata[0];
  let value = input_values[index];
  let zero_index = zero_prefix[index];
  let is_zero = zero_flags[index];
  let one_index = zero_count + index - zero_index;
  let target_index = select(one_index, zero_index, is_zero == 1u);

  output_values[target_index] = value;
}
