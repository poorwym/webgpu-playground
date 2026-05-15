import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { mat4, vec3 } from 'wgpu-matrix'
import { mesh } from '../meshes/stanfordDragon'

import fragmentWGSL from '../shaders/shadow-mapping-point/frag.wgsl'
import fragmentShadowWGSL from '../shaders/shadow-mapping-point/fragShadow.wgsl'
import vertexWGSL from '../shaders/shadow-mapping-point/vertex.wgsl'
import vertexShadowWGSL from '../shaders/shadow-mapping-point/vertexShadow.wgsl'

export const Route = createFileRoute('/shadowMappingPoint')({
  component: ShadowPointDragonDemo,
})

const shadowDepthTextureSize = 1024
const shadowFaceCount = 6
const farPlane = 300

function ShadowPointDragonDemo() {
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

      const gpuDevice = await adapter?.requestDevice()

      if (!adapter || !gpuDevice) return
      const device = gpuDevice

      const context = canvas.getContext('webgpu')
      if (!context) return
      const gpuContext = context

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
        size: [shadowDepthTextureSize, shadowDepthTextureSize, shadowFaceCount],
        textureBindingViewDimension: 'cube',
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        format: 'depth32float',
      })

      const shadowDepthCubeTextureView = shadowDepthTexture.createView({
        dimension: 'cube',
      })

      const shadowDepthFaceTextureViews = Array.from(
        { length: shadowFaceCount },
        (_, face) =>
          shadowDepthTexture.createView({
            dimension: '2d',
            baseArrayLayer: face,
            arrayLayerCount: 1,
          }),
      )

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
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
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
        fragment: {
          module: device.createShaderModule({
            code: fragmentShadowWGSL,
          }),
          targets: [],
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
            visibility: GPUShaderStage.FRAGMENT,
            texture: {
              sampleType: 'depth',
              viewDimension: 'cube',
            },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
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

      const colorAttachment: GPURenderPassColorAttachment = {
        view: undefined as unknown as GPUTextureView,
        clearValue: [0.5, 0.5, 0.5, 1.0],
        loadOp: 'clear',
        storeOp: 'store',
      }

      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [colorAttachment],
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

      const shadowSceneUniformBuffers = Array.from(
        { length: shadowFaceCount },
        () =>
          device.createBuffer({
            size: 4 * 16 + 4 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          }),
      )

      const sceneUniformBuffer = device.createBuffer({
        size: 4 * 16 + 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      const shadowSceneBindGroups = shadowSceneUniformBuffers.map((buffer) =>
        device.createBindGroup({
          layout: uniformBufferBindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: buffer,
            },
          ],
        }),
      )

      const sceneBindGroupForRender = device.createBindGroup({
        layout: bglForRender,
        entries: [
          {
            binding: 0,
            resource: sceneUniformBuffer,
          },
          {
            binding: 1,
            resource: shadowDepthCubeTextureView,
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

      const upVector = [0, 1, 0]
      const origin = [0, 0, 0]
      const farPlaneUniform = new Float32Array([farPlane])

      function writeBufferData(
        buffer: GPUBuffer,
        bufferOffset: number,
        data: Float32Array,
      ) {
        device.queue.writeBuffer(
          buffer,
          bufferOffset,
          data.buffer as ArrayBuffer,
          data.byteOffset,
          data.byteLength,
        )
      }

      const projectionMatrix = mat4.perspective(
        (2 * Math.PI) / 5,
        aspect,
        1,
        2000.0,
      )

      // const lightPosition = vec3.fromValues(0, 35, 0)
      const lightPosition = vec3.fromValues(0, 60, -40)

      const lightProjectionMatrix = mat4.perspective(
        Math.PI / 2,
        1,
        1,
        farPlane,
      )

      lightProjectionMatrix[5] *= -1 // TODO: Y-Flip, Detailed comments will be added later.

      const faceDirections = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]

      const faceUpVectors = [
        [0, -1, 0],
        [1, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
        [0, -1, 0],
        [0, -1, 0],
      ]

      // const faceUpVectors = [
      //   [0, 1, 0],
      //   [0, 1, 0],
      //   [0, 0, 1],
      //   [0, 0, -1],
      //   [0, 1, 0],
      //   [0, 1, 0],
      // ]

      for (let face = 0; face < shadowFaceCount; face++) {
        const faceTarget = vec3.add(lightPosition, faceDirections[face])
        const lightViewMatrix = mat4.lookAt(
          lightPosition,
          faceTarget,
          faceUpVectors[face],
        )
        const lightViewProjMatrix = mat4.multiply(
          lightProjectionMatrix,
          lightViewMatrix,
        )

        writeBufferData(shadowSceneUniformBuffers[face], 0, lightViewProjMatrix)
        writeBufferData(shadowSceneUniformBuffers[face], 64, lightPosition)
        writeBufferData(shadowSceneUniformBuffers[face], 76, farPlaneUniform)
      }

      const viewProjMatrix = mat4.create()
      const modelMatrix = mat4.translation([0, -45, 0])

      // sceneUniformBuffer layout:
      //
      // offset 0:  cameraViewProjMatrix
      // offset 64: lightPosition
      // offset 76: farPlane
      writeBufferData(sceneUniformBuffer, 64, lightPosition)
      writeBufferData(sceneUniformBuffer, 76, farPlaneUniform)

      writeBufferData(modelUniformBuffer, 0, modelMatrix)

      function getCameraViewProjMatrix() {
        const eyePosition = [0, 50, -100]

        const rad = Math.PI * (Date.now() / 2000)
        const rotation = mat4.rotateY(mat4.translation(origin), rad)

        vec3.transformMat4(eyePosition, rotation, eyePosition)

        const viewMatrix = mat4.lookAt(eyePosition, origin, upVector)

        mat4.multiply(projectionMatrix, viewMatrix, viewProjMatrix)

        return viewProjMatrix
      }

      const shadowPassDescriptors = shadowDepthFaceTextureViews.map(
        (view): GPURenderPassDescriptor => ({
          colorAttachments: [],
          depthStencilAttachment: {
            view,
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
          },
        }),
      )

      function frame() {
        if (disposed) return

        const cameraViewProj = getCameraViewProjMatrix()

        writeBufferData(sceneUniformBuffer, 0, cameraViewProj)

        colorAttachment.view = gpuContext.getCurrentTexture().createView()

        const commandEncoder = device.createCommandEncoder()

        // Shadow passes
        for (let face = 0; face < shadowFaceCount; face++) {
          const shadowPass = commandEncoder.beginRenderPass(
            shadowPassDescriptors[face],
          )

          shadowPass.setPipeline(shadowPipeline)
          shadowPass.setBindGroup(0, shadowSceneBindGroups[face])
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
