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
import sampleSelfWGSL from '../shaders/sampleSelf.frag.wgsl'

export const Route = createFileRoute('/fractalCube')({
  component: SelfTextureCube,
})

function SelfTextureCube() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let animationId: number
    let device: GPUDevice | null = null

    async function init() {
      if (!canvasRef.current) return

      const canvas = canvasRef.current

      const adapter = await navigator.gpu?.requestAdapter({
        featureLevel: 'compatibility',
      })
      device = await adapter?.requestDevice()

      if (!adapter || !device) return

      const context = canvas.getContext('webgpu')!

      const devicePixelRatio = window.devicePixelRatio
      canvas.width = canvas.clientWidth * devicePixelRatio
      canvas.height = canvas.clientHeight * devicePixelRatio

      const presentationFormat = navigator.gpu.getPreferredCanvasFormat()

      context.configure({
        device,
        format: presentationFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      })

      // ===== Vertex Buffer =====
      const verticesBuffer = device.createBuffer({
        size: cubeVertexArray.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      })
      new Float32Array(verticesBuffer.getMappedRange()).set(cubeVertexArray)
      verticesBuffer.unmap()

      // ===== Pipeline =====
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: device.createShaderModule({ code: basicVertWGSL }),
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
            code: sampleSelfWGSL,
          }),
          targets: [{ format: presentationFormat }],
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

      // ===== Depth =====
      const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })

      // ===== Uniform =====
      const uniformBuffer = device.createBuffer({
        size: 4 * 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      // ===== Feedback Texture（关键点）=====
      const cubeTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: presentationFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })

      const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
      })

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: cubeTexture.createView() },
        ],
      })

      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: undefined!,
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

      // ===== Camera =====
      const aspect = canvas.width / canvas.height
      const projectionMatrix = mat4.perspective(
        (2 * Math.PI) / 5,
        aspect,
        1,
        100,
      )
      const mvp = mat4.create()

      function getMatrix() {
        const view = mat4.identity()
        mat4.translate(view, [0, 0, -4], view)

        const t = Date.now() / 1000
        mat4.rotate(view, [Math.sin(t), Math.cos(t), 0], 1, view)

        mat4.multiply(projectionMatrix, view, mvp)
        return mvp
      }

      function frame() {
        if (!device) return

        const matrix = getMatrix()

        device.queue.writeBuffer(
          uniformBuffer,
          0,
          matrix.buffer,
          matrix.byteOffset,
          matrix.byteLength,
        )

        const currentTexture = context.getCurrentTexture()
        renderPassDescriptor.colorAttachments[0].view =
          currentTexture.createView()

        const encoder = device.createCommandEncoder()

        const pass = encoder.beginRenderPass(renderPassDescriptor)
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.setVertexBuffer(0, verticesBuffer)
        pass.draw(cubeVertexCount)
        pass.end()

        // feedback（上一帧作为纹理）
        encoder.copyTextureToTexture(
          { texture: currentTexture },
          { texture: cubeTexture },
          [canvas.width, canvas.height],
        )

        device.queue.submit([encoder.finish()])

        animationId = requestAnimationFrame(frame)
      }

      frame()
    }

    init()

    return () => {
      cancelAnimationFrame(animationId)
      device?.destroy?.() // 可选
    }
  }, [])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
}
