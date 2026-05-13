import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { mat4, vec3 } from 'wgpu-matrix'
import { mesh } from '../meshes/stanfordDragon'

import vertexShadowWGSL from '../shaders/shadow-mapping/vertexShadow.wgsl'
import vertexWGSL from '../shaders/shadow-mapping/vertex.wgsl'
import fragmentWGSL from '../shaders/shadow-mapping/frag.wgsl'

export const Route = createFileRoute('/shadowMapping')({
  component: ShadowDragonDemo,
})

const shadowDepthTextureSize = 1024

function ShadowDragonDemo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let animationFrameId = 0
    let disposed = false

    async function init() {
      const canvas = canvasRef.current
      if (!canvas) return

      const adapter = await navigator.gpu?.requestAdapter({
        featureLevel: 'compatibility',
      })

      const device = await adapter?.requestDevice()

      if (!adapter || !device) return

      const context = canvas.getContext('webgpu')
      if (!context) return

      const devicePixelRatio = window.devicePixelRatio
      canvas.width = canvas.clientWidth * devicePixelRatio
      canvas.height = canvas.clientHeight * devicePixelRatio

      const aspect = canvas.width / canvas.height
      const presentationFormat = navigator.gpu.getPreferredCanvasFormat()

      context.configure({
        device,
        format: presentationFormat,
      })

      // ------------------------------------------------------------
      // Vertex Buffer
      // ------------------------------------------------------------

      const vertexBuffer = device.createBuffer({
        size: mesh.positions.length * 3 * 2 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      })

      {
        const mapping = new Float32Array(vertexBuffer.getMappedRange())

        for (let i = 0; i < mesh.positions.length; ++i) {
          mapping.set(mesh.positions[i], 6 * i)
          mapping.set(mesh.normals[i], 6 * i + 3)
        }

        vertexBuffer.unmap()
      }

      // ------------------------------------------------------------
      // Index Buffer
      // ------------------------------------------------------------

      const indexCount = mesh.triangles.length * 3

      const indexBuffer = device.createBuffer({
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

      // ------------------------------------------------------------
      // Shadow Depth Texture
      // ------------------------------------------------------------

      const shadowDepthTexture = device.createTexture({
        size: [shadowDepthTextureSize, shadowDepthTextureSize, 1],
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        format: 'depth32float',
      })

      const shadowDepthTextureView = shadowDepthTexture.createView()

      // ------------------------------------------------------------
      // Common Pipeline Descriptors
      // ------------------------------------------------------------

      const vertexBuffers: Iterable<GPUVertexBufferLayout> = [
        {
          arrayStride: Float32Array.BYTES_PER_ELEMENT * 6,
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
          ],
        },
      ]

      const primitive: GPUPrimitiveState = {
        topology: 'triangle-list',
        cullMode: 'back',
      }

      const uniformBufferBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: {
              type: 'uniform',
            },
          },
        ],
      })

      // ------------------------------------------------------------
      // Shadow Pipeline
      // ------------------------------------------------------------

      const shadowPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [
            uniformBufferBindGroupLayout,
            uniformBufferBindGroupLayout,
          ],
        }),
        vertex: {
          module: device.createShaderModule({
            code: vertexShadowWGSL,
          }),
          buffers: vertexBuffers,
        },
        depthStencil: {
          depthWriteEnabled: true,
          depthCompare: 'less',
          format: 'depth32float',
        },
        primitive,
      })

      // ------------------------------------------------------------
      // Render Pipeline
      // ------------------------------------------------------------

      const bglForRender = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: {
              type: 'uniform',
            },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            texture: {
              sampleType: 'depth',
            },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            sampler: {
              type: 'comparison',
            },
          },
        ],
      })

      const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [bglForRender, uniformBufferBindGroupLayout],
        }),
        vertex: {
          module: device.createShaderModule({
            code: vertexWGSL,
          }),
          buffers: vertexBuffers,
        },
        fragment: {
          module: device.createShaderModule({
            code: fragmentWGSL,
          }),
          targets: [
            {
              format: presentationFormat,
            },
          ],
          constants: {
            shadowDepthTextureSize,
          },
        },
        depthStencil: {
          depthWriteEnabled: true,
          depthCompare: 'less',
          format: 'depth24plus-stencil8',
        },
        primitive,
      })

      // ------------------------------------------------------------
      // Main Depth Texture
      // ------------------------------------------------------------

      const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus-stencil8',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })

      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: undefined as unknown as GPUTextureView,
            clearValue: [0.5, 0.5, 0.5, 1.0],
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depthTexture.createView(),

          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',

          stencilClearValue: 0,
          stencilLoadOp: 'clear',
          stencilStoreOp: 'store',
        },
      }

      // ------------------------------------------------------------
      // Uniform Buffers
      // ------------------------------------------------------------

      const modelUniformBuffer = device.createBuffer({
        size: 4 * 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      const sceneUniformBuffer = device.createBuffer({
        size: 2 * 4 * 16 + 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      const sceneBindGroupForShadow = device.createBindGroup({
        layout: uniformBufferBindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: sceneUniformBuffer,
          },
        ],
      })

      const sceneBindGroupForRender = device.createBindGroup({
        layout: bglForRender,
        entries: [
          {
            binding: 0,
            resource: sceneUniformBuffer,
          },
          {
            binding: 1,
            resource: shadowDepthTextureView,
          },
          {
            binding: 2,
            resource: device.createSampler({
              compare: 'less',
            }),
          },
        ],
      })

      const modelBindGroup = device.createBindGroup({
        layout: uniformBufferBindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: modelUniformBuffer,
          },
        ],
      })

      // ------------------------------------------------------------
      // Matrices
      // ------------------------------------------------------------

      const eyePosition = [0, 50, -100]
      const upVector = [0, 1, 0]
      const origin = [0, 0, 0]

      const projectionMatrix = mat4.perspective(
        (2 * Math.PI) / 5,
        aspect,
        1,
        2000.0,
      )

      const viewMatrix = mat4.lookAt(eyePosition, origin, upVector)

      const lightPosition = vec3.fromValues(50, 100, -100)
      const lightViewMatrix = mat4.lookAt(lightPosition, origin, upVector)

      const lightProjectionMatrix = mat4.create()

      {
        const left = -80
        const right = 80
        const bottom = -80
        const top = 80
        const near = -200
        const far = 300

        mat4.ortho(left, right, bottom, top, near, far, lightProjectionMatrix)
      }

      const lightViewProjMatrix = mat4.multiply(
        lightProjectionMatrix,
        lightViewMatrix,
      )

      const viewProjMatrix = mat4.multiply(projectionMatrix, viewMatrix)

      const modelMatrix = mat4.translation([0, -45, 0])

      // sceneUniformBuffer layout:
      //
      // offset 0:   lightViewProjMatrix
      // offset 64:  cameraViewProjMatrix
      // offset 128: lightPosition
      device.queue.writeBuffer(sceneUniformBuffer, 0, lightViewProjMatrix)
      device.queue.writeBuffer(sceneUniformBuffer, 64, lightViewProjMatrix)
      device.queue.writeBuffer(sceneUniformBuffer, 128, lightPosition)

      device.queue.writeBuffer(modelUniformBuffer, 0, modelMatrix)

      function getCameraViewProjMatrix() {
        const eyePosition = [0, 50, -100]

        const rad = Math.PI * (Date.now() / 2000)
        const rotation = mat4.rotateY(mat4.translation(origin), rad)

        vec3.transformMat4(eyePosition, rotation, eyePosition)

        const viewMatrix = mat4.lookAt(eyePosition, origin, upVector)

        mat4.multiply(projectionMatrix, viewMatrix, viewProjMatrix)

        return viewProjMatrix
      }

      const shadowPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [],
        depthStencilAttachment: {
          view: shadowDepthTextureView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      }

      function frame() {
        if (disposed) return

        const cameraViewProj = getCameraViewProjMatrix()

        device.queue.writeBuffer(
          sceneUniformBuffer,
          64,
          cameraViewProj.buffer,
          cameraViewProj.byteOffset,
          cameraViewProj.byteLength,
        )

        renderPassDescriptor.colorAttachments![0]!.view = context
          .getCurrentTexture()
          .createView()

        const commandEncoder = device.createCommandEncoder()

        // Shadow pass
        {
          const shadowPass =
            commandEncoder.beginRenderPass(shadowPassDescriptor)

          shadowPass.setPipeline(shadowPipeline)
          shadowPass.setBindGroup(0, sceneBindGroupForShadow)
          shadowPass.setBindGroup(1, modelBindGroup)
          shadowPass.setVertexBuffer(0, vertexBuffer)
          shadowPass.setIndexBuffer(indexBuffer, 'uint16')
          shadowPass.drawIndexed(indexCount)

          shadowPass.end()
        }

        // Render pass
        {
          const renderPass =
            commandEncoder.beginRenderPass(renderPassDescriptor)

          renderPass.setPipeline(pipeline)
          renderPass.setBindGroup(0, sceneBindGroupForRender)
          renderPass.setBindGroup(1, modelBindGroup)
          renderPass.setVertexBuffer(0, vertexBuffer)
          renderPass.setIndexBuffer(indexBuffer, 'uint16')
          renderPass.drawIndexed(indexCount)

          renderPass.end()
        }

        device.queue.submit([commandEncoder.finish()])

        animationFrameId = requestAnimationFrame(frame)
      }

      animationFrameId = requestAnimationFrame(frame)
    }

    init()

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{
        display: 'block',
      }}
    />
  )
}
