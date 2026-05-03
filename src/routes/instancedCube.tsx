import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { mat4 } from 'wgpu-matrix'
import type { Mat4 } from 'wgpu-matrix'

import {
  cubeVertexArray,
  cubeVertexSize,
  cubeUVOffset,
  cubePositionOffset,
  cubeVertexCount,
} from '../meshes/cube'

import instancedVertWGSL from '../shaders/instanced.vert.wgsl'
import vertexPositionColorWGSL from '../shaders/vertexPositionColor.frag.wgsl'

export const Route = createFileRoute('/instancedCube')({
  component: InstancedCube,
})

function InstancedCube() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return

    let animationId = 0
    let mounted = true

    async function init() {
      const canvas = canvasRef.current!

      const adapter = await navigator.gpu?.requestAdapter({
        featureLevel: 'compatibility',
      })
      const device = await adapter?.requestDevice()

      const context = canvas.getContext('webgpu')!

      const devicePixelRatio = window.devicePixelRatio
      canvas.width = canvas.clientWidth * devicePixelRatio
      canvas.height = canvas.clientHeight * devicePixelRatio

      const presentationFormat = navigator.gpu.getPreferredCanvasFormat()

      if (!device || !adapter) {
        console.error('WebGPU is not supported or context is unavailable.')
        return
      }

      context.configure({
        device,
        format: presentationFormat,
      })

      // =========================
      // Vertex Buffer
      // =========================
      const verticesBuffer = device.createBuffer({
        size: cubeVertexArray.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      })
      new Float32Array(verticesBuffer.getMappedRange()).set(cubeVertexArray)
      verticesBuffer.unmap()

      // =========================
      // Pipeline
      // =========================
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: device.createShaderModule({
            code: instancedVertWGSL,
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

      // =========================
      // Depth Texture
      // =========================
      const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })

      // =========================
      // Instance Data
      // =========================
      const xCount = 4
      const yCount = 4
      const numInstances = xCount * yCount

      const matrixFloatCount = 16
      const matrixSize = 4 * matrixFloatCount
      const uniformBufferSize = numInstances * matrixSize

      const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      const uniformBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      })

      const aspect = canvas.width / canvas.height
      const projectionMatrix = mat4.perspective(
        (2 * Math.PI) / 5,
        aspect,
        1,
        100,
      )

      const viewMatrix = mat4.translation([0, 0, -12])

      const modelMatrices: Mat4[] = new Array(numInstances)
      const mvpMatricesData = new Float32Array(matrixFloatCount * numInstances)

      const step = 4.0

      let m = 0
      for (let x = 0; x < xCount; x++) {
        for (let y = 0; y < yCount; y++) {
          modelMatrices[m] = mat4.translation([
            step * (x - xCount / 2 + 0.5),
            step * (y - yCount / 2 + 0.5),
            0,
          ])
          m++
        }
      }

      const tmpMat4 = mat4.create()

      function updateTransformationMatrix() {
        const now = Date.now() / 1000

        let m = 0
        let i = 0

        for (let x = 0; x < xCount; x++) {
          for (let y = 0; y < yCount; y++) {
            mat4.rotate(
              modelMatrices[i],
              [Math.sin((x + 0.5) * now), Math.cos((y + 0.5) * now), 0],
              1,
              tmpMat4,
            )

            mat4.multiply(viewMatrix, tmpMat4, tmpMat4)
            mat4.multiply(projectionMatrix, tmpMat4, tmpMat4)

            mvpMatricesData.set(tmpMat4, m)

            i++
            m += matrixFloatCount
          }
        }
      }

      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: undefined as any,
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

      function frame() {
        if (!mounted) return

        updateTransformationMatrix()

        device.queue.writeBuffer(
          uniformBuffer,
          0,
          mvpMatricesData.buffer,
          mvpMatricesData.byteOffset,
          mvpMatricesData.byteLength,
        )

        renderPassDescriptor.colorAttachments[0].view = context
          .getCurrentTexture()
          .createView()

        const commandEncoder = device.createCommandEncoder()
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor)

        passEncoder.setPipeline(pipeline)
        passEncoder.setBindGroup(0, uniformBindGroup)
        passEncoder.setVertexBuffer(0, verticesBuffer)

        passEncoder.draw(cubeVertexCount, numInstances, 0, 0)

        passEncoder.end()

        device.queue.submit([commandEncoder.finish()])

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

  return <canvas ref={canvasRef} className="w-full h-full" />
}
