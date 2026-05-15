import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { mat4, vec3, vec4 } from 'wgpu-matrix'

import { mesh } from '../meshes/stanfordDragon'
import fragmentDeferredRenderingWGSL from '../shaders/deferred-rendering/fragmentDeferredRendering.wgsl'
import fragmentWriteGBuffersWGSL from '../shaders/deferred-rendering/fragmentWriteGBuffers.wgsl'
import lightUpdateWGSL from '../shaders/deferred-rendering/lightUpdate.wgsl'
import vertexTextureQuadWGSL from '../shaders/deferred-rendering/vertexTextureQuad.wgsl'
import vertexWriteGBuffersWGSL from '../shaders/deferred-rendering/vertexWriteGBuffers.wgsl'

export const Route = createFileRoute('/deferredRendering')({
  component: DeferredRenderingDemo,
})

const kMaxNumLights = 1024
const kInitialNumLights = 128
const kVertexStride = 8
const lightExtentMin = [-50, -30, -50]
const lightExtentMax = [50, 50, 50]

function DeferredRenderingDemo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const configUniformBufferRef = useRef<GPUBuffer | null>(null)
  const deviceRef = useRef<GPUDevice | null>(null)
  const [numLights, setNumLights] = useState(kInitialNumLights)

  useEffect(() => {
    let animationFrameId = 0
    let disposed = false

    async function init() {
      const canvas = canvasRef.current
      if (!canvas) return

      const adapter = await navigator.gpu.requestAdapter({
        featureLevel: 'compatibility',
      })

      if (!adapter) {
        console.error('WebGPU adapter is not available.')
        return
      }

      const requiredLimits: Record<string, GPUSize32> = {}
      if (adapter.limits.maxStorageBuffersInFragmentStage < 1) {
        console.error(
          'WebGPU adapter does not support storage buffers in fragment shaders.',
        )
        return
      }
      requiredLimits.maxStorageBuffersInFragmentStage = 1

      const device = await adapter.requestDevice({
        requiredLimits,
      })
      const context = canvas.getContext('webgpu')

      if (!context) {
        console.error('WebGPU canvas context is not available.')
        return
      }

      if (disposed) return
      deviceRef.current = device

      const devicePixelRatio = window.devicePixelRatio
      canvas.width = canvas.clientWidth * devicePixelRatio
      canvas.height = canvas.clientHeight * devicePixelRatio

      const aspect = canvas.width / canvas.height
      const presentationFormat = navigator.gpu.getPreferredCanvasFormat()

      context.configure({
        device,
        format: presentationFormat,
      })

      const vertexBuffer = device.createBuffer({
        label: 'model vertex buffer',
        size:
          mesh.positions.length *
          kVertexStride *
          Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      })

      {
        const mapping = new Float32Array(vertexBuffer.getMappedRange())

        for (let i = 0; i < mesh.positions.length; ++i) {
          mapping.set(mesh.positions[i], kVertexStride * i)
          mapping.set(mesh.normals[i], kVertexStride * i + 3)
          mapping.set(mesh.uvs[i], kVertexStride * i + 6)
        }

        vertexBuffer.unmap()
      }

      const indexCount = mesh.triangles.length * 3
      const indexBuffer = device.createBuffer({
        label: 'model index buffer',
        size: indexCount * Uint16Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true,
      })

      {
        const mapping = new Uint16Array(indexBuffer.getMappedRange())

        for (let i = 0; i < mesh.triangles.length; ++i) {
          mapping.set(mesh.triangles[i], 3 * i)
        }

        indexBuffer.unmap()
      }

      const gBufferTextureNormal = device.createTexture({
        size: [canvas.width, canvas.height],
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        format: 'rgba16float',
      })
      const gBufferTextureAlbedo = device.createTexture({
        size: [canvas.width, canvas.height],
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        format: 'bgra8unorm',
      })
      const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })

      const gBufferTextureViews = [
        gBufferTextureNormal.createView({ label: 'gbuffer texture normal' }),
        gBufferTextureAlbedo.createView({ label: 'gbuffer texture albedo' }),
        depthTexture.createView({ label: 'gbuffer depth texture' }),
      ]

      const vertexBuffers: Iterable<GPUVertexBufferLayout> = [
        {
          arrayStride: Float32Array.BYTES_PER_ELEMENT * kVertexStride,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: 'float32x3',
            },
            {
              shaderLocation: 1,
              offset: Float32Array.BYTES_PER_ELEMENT * 3,
              format: 'float32x3',
            },
            {
              shaderLocation: 2,
              offset: Float32Array.BYTES_PER_ELEMENT * 6,
              format: 'float32x2',
            },
          ],
        },
      ]

      const primitive: GPUPrimitiveState = {
        topology: 'triangle-list',
        cullMode: 'back',
      }

      const writeGBuffersPipeline = device.createRenderPipeline({
        label: 'write gbuffers',
        layout: 'auto',
        vertex: {
          module: device.createShaderModule({
            code: vertexWriteGBuffersWGSL,
          }),
          buffers: vertexBuffers,
        },
        fragment: {
          module: device.createShaderModule({
            code: fragmentWriteGBuffersWGSL,
          }),
          targets: [{ format: 'rgba16float' }, { format: 'bgra8unorm' }],
        },
        depthStencil: {
          depthWriteEnabled: true,
          depthCompare: 'less',
          format: 'depth24plus',
        },
        primitive,
      })

      const gBufferTexturesBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {
              sampleType: 'unfilterable-float',
            },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {
              sampleType: 'unfilterable-float',
            },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {
              sampleType: 'unfilterable-float',
            },
          },
        ],
      })

      const lightsBufferBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
            buffer: {
              type: 'read-only-storage',
            },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
            buffer: {
              type: 'uniform',
            },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: {
              type: 'uniform',
            },
          },
        ],
      })

      const deferredRenderPipeline = device.createRenderPipeline({
        label: 'deferred final',
        layout: device.createPipelineLayout({
          bindGroupLayouts: [
            gBufferTexturesBindGroupLayout,
            lightsBufferBindGroupLayout,
          ],
        }),
        vertex: {
          module: device.createShaderModule({
            code: vertexTextureQuadWGSL,
          }),
        },
        fragment: {
          module: device.createShaderModule({
            code: fragmentDeferredRenderingWGSL,
          }),
          targets: [
            {
              format: presentationFormat,
            },
          ],
        },
        primitive,
      })

      const writeGBufferPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: gBufferTextureViews[0],
            clearValue: [0, 0, 1, 1],
            loadOp: 'clear',
            storeOp: 'store',
          },
          {
            view: gBufferTextureViews[1],
            clearValue: [0, 0, 0, 1],
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: gBufferTextureViews[2],
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      }

      const textureQuadPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: undefined,
            clearValue: [0, 0, 0, 1],
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      }

      const configUniformBuffer = device.createBuffer({
        label: 'config uniforms',
        size: Uint32Array.BYTES_PER_ELEMENT,
        mappedAtCreation: true,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      new Uint32Array(configUniformBuffer.getMappedRange())[0] = numLights
      configUniformBuffer.unmap()
      configUniformBufferRef.current = configUniformBuffer

      const modelUniformBuffer = device.createBuffer({
        label: 'model matrix uniform',
        size: 4 * 16 * 2,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      const cameraUniformBuffer = device.createBuffer({
        label: 'camera matrix uniform',
        size: 4 * 16 * 2,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      const sceneUniformBindGroup = device.createBindGroup({
        layout: writeGBuffersPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: modelUniformBuffer } },
          { binding: 1, resource: { buffer: cameraUniformBuffer } },
        ],
      })

      const gBufferTexturesBindGroup = device.createBindGroup({
        layout: gBufferTexturesBindGroupLayout,
        entries: [
          { binding: 0, resource: gBufferTextureViews[0] },
          { binding: 1, resource: gBufferTextureViews[1] },
          { binding: 2, resource: gBufferTextureViews[2] },
        ],
      })

      const extent = vec3.sub(lightExtentMax, lightExtentMin)
      const lightDataStride = 8
      const bufferSizeInByte =
        Float32Array.BYTES_PER_ELEMENT * lightDataStride * kMaxNumLights
      const lightsBuffer = device.createBuffer({
        label: 'lights storage',
        size: bufferSizeInByte,
        usage: GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
      })

      const lightData = new Float32Array(lightsBuffer.getMappedRange())
      const tmpVec4 = vec4.create()
      let offset = 0

      for (let i = 0; i < kMaxNumLights; i++) {
        offset = lightDataStride * i

        for (let j = 0; j < 3; j++) {
          tmpVec4[j] = Math.random() * extent[j] + lightExtentMin[j]
        }

        tmpVec4[3] = 1
        lightData.set(tmpVec4, offset)

        tmpVec4[0] = Math.random() * 2
        tmpVec4[1] = Math.random() * 2
        tmpVec4[2] = Math.random() * 2
        tmpVec4[3] = 20
        lightData.set(tmpVec4, offset + 4)
      }

      lightsBuffer.unmap()

      const lightExtentBuffer = device.createBuffer({
        label: 'light extent uniform',
        size: 4 * 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      const lightExtentData = new Float32Array(8)
      lightExtentData.set(lightExtentMin, 0)
      lightExtentData.set(lightExtentMax, 4)
      device.queue.writeBuffer(
        lightExtentBuffer,
        0,
        lightExtentData.buffer,
        lightExtentData.byteOffset,
        lightExtentData.byteLength,
      )

      const lightUpdateComputePipeline = device.createComputePipeline({
        label: 'light update',
        layout: 'auto',
        compute: {
          module: device.createShaderModule({
            code: lightUpdateWGSL,
          }),
        },
      })

      const lightsBufferBindGroup = device.createBindGroup({
        layout: lightsBufferBindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: lightsBuffer },
          },
          {
            binding: 1,
            resource: { buffer: configUniformBuffer },
          },
          {
            binding: 2,
            resource: { buffer: cameraUniformBuffer },
          },
        ],
      })

      const lightsBufferComputeBindGroup = device.createBindGroup({
        layout: lightUpdateComputePipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: { buffer: lightsBuffer },
          },
          {
            binding: 1,
            resource: { buffer: configUniformBuffer },
          },
          {
            binding: 2,
            resource: { buffer: lightExtentBuffer },
          },
        ],
      })

      const eyePosition = [0, 50, -100]
      const upVector = [0, 1, 0]
      const origin = [0, 0, 0]
      const projectionMatrix = mat4.perspective(
        (2 * Math.PI) / 5,
        aspect,
        1,
        2000,
      )

      const modelMatrix = mat4.translation([0, -45, 0])
      device.queue.writeBuffer(modelUniformBuffer, 0, modelMatrix)

      const invertTransposeModelMatrix = mat4.invert(modelMatrix)
      mat4.transpose(invertTransposeModelMatrix, invertTransposeModelMatrix)
      device.queue.writeBuffer(
        modelUniformBuffer,
        64,
        invertTransposeModelMatrix.buffer,
        invertTransposeModelMatrix.byteOffset,
        invertTransposeModelMatrix.byteLength,
      )

      function getCameraViewProjMatrix() {
        const rad = Math.PI * (Date.now() / 5000)
        const rotation = mat4.rotateY(mat4.translation(origin), rad)
        const rotatedEyePosition = vec3.transformMat4(eyePosition, rotation)
        const viewMatrix = mat4.lookAt(rotatedEyePosition, origin, upVector)

        return mat4.multiply(projectionMatrix, viewMatrix)
      }

      function frame() {
        if (disposed) return

        const cameraViewProj = getCameraViewProjMatrix()
        device.queue.writeBuffer(
          cameraUniformBuffer,
          0,
          cameraViewProj.buffer,
          cameraViewProj.byteOffset,
          cameraViewProj.byteLength,
        )

        const cameraInvViewProj = mat4.invert(cameraViewProj)
        device.queue.writeBuffer(
          cameraUniformBuffer,
          64,
          cameraInvViewProj.buffer,
          cameraInvViewProj.byteOffset,
          cameraInvViewProj.byteLength,
        )

        const commandEncoder = device.createCommandEncoder()

        const gBufferPass = commandEncoder.beginRenderPass(
          writeGBufferPassDescriptor,
        )
        gBufferPass.setPipeline(writeGBuffersPipeline)
        gBufferPass.setBindGroup(0, sceneUniformBindGroup)
        gBufferPass.setVertexBuffer(0, vertexBuffer)
        gBufferPass.setIndexBuffer(indexBuffer, 'uint16')
        gBufferPass.drawIndexed(indexCount)
        gBufferPass.end()

        const lightPass = commandEncoder.beginComputePass()
        lightPass.setPipeline(lightUpdateComputePipeline)
        lightPass.setBindGroup(0, lightsBufferComputeBindGroup)
        lightPass.dispatchWorkgroups(Math.ceil(kMaxNumLights / 64))
        lightPass.end()

        textureQuadPassDescriptor.colorAttachments[0].view = context
          .getCurrentTexture()
          .createView()
        const deferredRenderingPass = commandEncoder.beginRenderPass(
          textureQuadPassDescriptor,
        )
        deferredRenderingPass.setPipeline(deferredRenderPipeline)
        deferredRenderingPass.setBindGroup(0, gBufferTexturesBindGroup)
        deferredRenderingPass.setBindGroup(1, lightsBufferBindGroup)
        deferredRenderingPass.draw(6)
        deferredRenderingPass.end()

        device.queue.submit([commandEncoder.finish()])

        animationFrameId = requestAnimationFrame(frame)
      }

      animationFrameId = requestAnimationFrame(frame)
    }

    init()

    return () => {
      disposed = true
      deviceRef.current = null
      configUniformBufferRef.current = null
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  function handleNumLightsChange(value: number) {
    setNumLights(value)

    const device = deviceRef.current
    const configUniformBuffer = configUniformBufferRef.current
    if (!device || !configUniformBuffer) return

    device.queue.writeBuffer(
      configUniformBuffer,
      0,
      new Uint32Array([value]),
    )
  }

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full" />
      <label className="absolute left-4 top-4 flex items-center gap-3 rounded bg-black/70 px-3 py-2 text-sm text-white">
        <span>Lights</span>
        <input
          type="range"
          min={1}
          max={kMaxNumLights}
          step={1}
          value={numLights}
          onChange={(event) => handleNumLightsChange(event.target.valueAsNumber)}
        />
        <output className="w-10 text-right tabular-nums">{numLights}</output>
      </label>
    </div>
  )
}
