import { mat4, vec3, vec4 } from 'wgpu-matrix'

// 1️⃣ Projection
const projectionMatrix = mat4.perspective((2 * Math.PI) / 5, 800 / 600, 1, 3000)
// console.log('projectionMatrix', projectionMatrix)

// 2️⃣ View
const viewMatrix = mat4.identity()

// 3️⃣ PV & inverse
const pv = mat4.multiply(projectionMatrix, viewMatrix)
const invPV = mat4.inverse(pv)

console.log(10000000000000000000000000000)

// ----------------------------------------
// 🧪 从 clip → direction
// ----------------------------------------

// clip space 点
const z = [-10, -1, 0, 1, 1.0001, 1.1, 10]
for (let i = 0; i < 7; i++) {
  const clip = vec4.fromValues(0.5, 0.5, z[i], 1)
  console.log('clip point', clip)

  // 4️⃣ 反投影
  const worldH = vec4.transformMat4(clip, invPV)

  // 5️⃣ 透视除法（wgpu-matrix 有 helper）
  const world = vec3.fromValues(
    worldH[0] / worldH[3],
    worldH[1] / worldH[3],
    worldH[2] / worldH[3],
  )

  console.log('world point', world)
  console.log('worldH', worldH)

  // 6️⃣ direction = normalize(world - cameraPos)
  // （camera 在原点 → 直接 normalize）
  const direction = vec3.normalize(world)

  console.log('direction', direction)
}
