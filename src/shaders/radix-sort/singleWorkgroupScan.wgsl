struct Params {
  count: u32,
  bit: u32,
}

const WORKGROUP_SIZE = 256u;

@group(0) @binding(0) var<storage, read> zero_flags: array<u32>;
@group(0) @binding(1) var<storage, read_write> zero_prefix: array<u32>;
@group(0) @binding(2) var<storage, read_write> metadata: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

var<workgroup> scan_values: array<u32, 256>;
var<workgroup> previous_values: array<u32, 256>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) local_id: vec3<u32>) {
  let index = local_id.x;

  if (index < params.count) {
    scan_values[index] = zero_flags[index];
  } else {
    scan_values[index] = 0u;
  }

  workgroupBarrier();

  var offset = 1u;
  loop {
    if (offset >= WORKGROUP_SIZE) {
      break;
    }

    previous_values[index] = scan_values[index];
    workgroupBarrier();

    if (index >= offset) {
      scan_values[index] = previous_values[index] + previous_values[index - offset];
    } else {
      scan_values[index] = previous_values[index];
    }

    workgroupBarrier();
    offset = offset << 1u;
  }

  if (index < params.count) {
    zero_prefix[index] = scan_values[index] - zero_flags[index];
  }

  if (index == 0u) {
    metadata[0] = scan_values[params.count - 1u];
  }
}
