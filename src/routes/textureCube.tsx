import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { mat4 } from 'wgpu-matrix'

import {
  cubeVertexArray,
  cubeVertexSize,
  cubeUVOffset,
  cubePositionOffset,
  cubeVertexCount,
} from '../meshes/cube'

import basicVertWGSL from '../shaders/basic.vert.wgsl'
import sampleTextureMixColorWGSL from '../shaders/sampleTextureMixColor.frag.wgsl'

export const Route = createFileRoute('/textureCube')({
  component: TexturedCube,
})

function TexturedCube() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let mounted = true
    let animationFrameId = 0

    let device: GPUDevice | null = null
    let context: GPUCanvasContext | null = null
    let pipeline: GPURenderPipeline | null = null
    let verticesBuffer: GPUBuffer | null = null
    let uniformBuffer: GPUBuffer | null = null
    let uniformBindGroup: GPUBindGroup | null = null
    let depthTexture: GPUTexture | null = null

    let presentationFormat: GPUTextureFormat
    let projectionMatrix = mat4.create()
    const modelViewProjectionMatrix = mat4.create()

    async function init() {
      const canvas = canvasRef.current
      if (!canvas) return

      const adapter = await navigator.gpu?.requestAdapter({
        featureLevel: 'compatibility',
      })
      const gpuDevice = await adapter?.requestDevice()

      if (!mounted || !gpuDevice) return

      device = gpuDevice
      context = canvas.getContext('webgpu')
      if (!context) {
        throw new Error('WebGPU context is not available.')
      }

      presentationFormat = navigator.gpu.getPreferredCanvasFormat()

      function configureCanvas() {
        if (!device || !context || !canvas) return

        const devicePixelRatio = window.devicePixelRatio || 1
        const width = Math.max(
          1,
          Math.floor(canvas.clientWidth * devicePixelRatio),
        )
        const height = Math.max(
          1,
          Math.floor(canvas.clientHeight * devicePixelRatio),
        )

        canvas.width = width
        canvas.height = height

        context.configure({
          device,
          format: presentationFormat,
          alphaMode: 'opaque',
        })

        depthTexture?.destroy()
        depthTexture = device.createTexture({
          size: [canvas.width, canvas.height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        })

        const aspect = canvas.width / canvas.height
        projectionMatrix = mat4.perspective((2 * Math.PI) / 5, aspect, 1, 100.0)
      }

      configureCanvas()

      // Vertex Buffer
      verticesBuffer = device.createBuffer({
        size: cubeVertexArray.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      })
      new Float32Array(verticesBuffer.getMappedRange()).set(cubeVertexArray)
      verticesBuffer.unmap()

      // Pipeline
      pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: device.createShaderModule({
            code: basicVertWGSL,
          }),
          buffers: [
            {
              arrayStride: cubeVertexSize,
              attributes: [
                {
                  shaderLocation: 0,
                  offset: cubePositionOffset,
                  format: 'float32x4',
                },
                {
                  shaderLocation: 1,
                  offset: cubeUVOffset,
                  format: 'float32x2',
                },
              ],
            },
          ],
        },
        fragment: {
          module: device.createShaderModule({
            code: sampleTextureMixColorWGSL,
          }),
          targets: [
            {
              format: presentationFormat,
            },
          ],
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'back',
        },
        depthStencil: {
          depthWriteEnabled: true,
          depthCompare: 'less',
          format: 'depth24plus',
        },
      })

      // Uniform Buffer
      const uniformBufferSize = 4 * 16 // 16 float32 = 64 bytes
      uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      // console.log('Uniform Buffer Label:', uniformBuffer.label)

      // Texture
      const response = await fetch('logo192.png')
      const imageBitmap = await createImageBitmap(await response.blob())

      const cubeTexture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height, 1],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })

      device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture: cubeTexture },
        [imageBitmap.width, imageBitmap.height],
      )

      // Sampler
      const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
      })

      // Bind Group
      uniformBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: cubeTexture.createView() },
        ],
      })

      function getTransformationMatrix() {
        const viewMatrix = mat4.identity()
        mat4.translate(viewMatrix, [0, 0, -4], viewMatrix)

        const now = Date.now() / 1000
        mat4.rotate(
          viewMatrix,
          [Math.sin(now), Math.cos(now), 0],
          1,
          viewMatrix,
        )

        mat4.multiply(projectionMatrix, viewMatrix, modelViewProjectionMatrix)
        return modelViewProjectionMatrix
      }

      function frame() {
        if (
          !mounted ||
          !device ||
          !context ||
          !pipeline ||
          !verticesBuffer ||
          !uniformBuffer ||
          !uniformBindGroup ||
          !depthTexture
        ) {
          return
        }

        const transformationMatrix = getTransformationMatrix()

        device.queue.writeBuffer(
          uniformBuffer,
          0,
          transformationMatrix.buffer,
          transformationMatrix.byteOffset,
          transformationMatrix.byteLength,
        )

        const currentTextureView = context.getCurrentTexture().createView()

        const renderPassDescriptor: GPURenderPassDescriptor = {
          colorAttachments: [
            {
              view: currentTextureView,
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
          },
        }

        const commandEncoder = device.createCommandEncoder()
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor)

        passEncoder.setPipeline(pipeline)
        passEncoder.setBindGroup(0, uniformBindGroup)
        passEncoder.setVertexBuffer(0, verticesBuffer)
        passEncoder.draw(cubeVertexCount)

        passEncoder.end()
        device.queue.submit([commandEncoder.finish()])

        animationFrameId = requestAnimationFrame(frame)
      }

      const handleResize = () => {
        configureCanvas()
      }

      window.addEventListener('resize', handleResize)
      animationFrameId = requestAnimationFrame(frame)

      return () => {
        window.removeEventListener('resize', handleResize)
      }
    }

    let cleanup: (() => void) | void

    init().then((result) => {
      cleanup = result
    })

    return () => {
      mounted = false
      cancelAnimationFrame(animationFrameId)
      cleanup?.()
      depthTexture?.destroy()
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
