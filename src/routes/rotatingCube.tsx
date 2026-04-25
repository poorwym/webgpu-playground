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
import vertexPositionColorWGSL from '../shaders/vertexPositionColor.frag.wgsl'

export const Route = createFileRoute('/rotatingCube')({
  component: RotatingCube,
})

function RotatingCube() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let mounted = true
    let animationId: number

    async function init() {
      if (!canvasRef.current) return

      const canvas = canvasRef.current

      const adapter = await navigator.gpu?.requestAdapter({
        featureLevel: 'compatibility',
      })

      if (!adapter) {
        console.error('WebGPU adapter unavailable')
        return
      }

      const device = await adapter.requestDevice()

      const context = canvas.getContext('webgpu')
      if (!context) return

      const dpr = window.devicePixelRatio || 1

      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr

      const presentationFormat = navigator.gpu.getPreferredCanvasFormat()

      context.configure({
        device,
        format: presentationFormat,
      })

      /*
       * Vertex Buffer
       */
      const vertexBuffer = device.createBuffer({
        size: cubeVertexArray.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      })

      new Float32Array(vertexBuffer.getMappedRange()).set(cubeVertexArray)

      vertexBuffer.unmap()

      /*
       * Pipeline
       */
      const pipeline = device.createRenderPipeline({
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
            code: vertexPositionColorWGSL,
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

      /*
       * Depth Texture
       */
      const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })

      /*
       * Uniform Buffer
       */
      const uniformBuffer = device.createBuffer({
        size: 4 * 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),

        entries: [
          {
            binding: 0,
            resource: {
              buffer: uniformBuffer,
            },
          },
        ],
      })

      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: undefined,

            clearValue: [0.5, 0.5, 0.5, 1],

            loadOp: 'clear',
            storeOp: 'store',
          },
        ],

        depthStencilAttachment: {
          view: depthTexture.createView(),

          depthClearValue: 1,

          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      }

      /*
       * MVP Matrix
       */
      const aspect = canvas.width / canvas.height

      const projectionMatrix = mat4.perspective(
        (2 * Math.PI) / 5,
        aspect,
        1,
        100,
      )

      const mvpMatrix = mat4.create()

      function getTransform() {
        const view = mat4.identity()

        mat4.translate(view, [0, 0, -4], view)

        const t = Date.now() / 1000

        mat4.rotate(view, [Math.sin(t), Math.cos(t), 0], 1, view)

        mat4.multiply(projectionMatrix, view, mvpMatrix)

        return mvpMatrix
      }

      /*
       * Render Loop
       */
      function frame() {
        if (!mounted) return

        const transform = getTransform()

        device.queue.writeBuffer(
          uniformBuffer,
          0,
          transform.buffer,
          transform.byteOffset,
          transform.byteLength,
        )

        renderPassDescriptor.colorAttachments![0].view = context
          .getCurrentTexture()
          .createView()

        const encoder = device.createCommandEncoder()

        const pass = encoder.beginRenderPass(renderPassDescriptor)

        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.setVertexBuffer(0, vertexBuffer)

        pass.draw(cubeVertexCount)

        pass.end()

        device.queue.submit([encoder.finish()])

        animationId = requestAnimationFrame(frame)
      }

      frame()
    }

    init()

    return () => {
      mounted = false
      cancelAnimationFrame(animationId)
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
