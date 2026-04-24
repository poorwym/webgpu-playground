import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import triangleVertWGSL from '../shaders/triangle.vert.wgsl'
import redFragWGSL from '../shaders/red.frag.wgsl'

export const Route = createFileRoute('/helloTriangle')({
  component: RouteComponent,
})

function RouteComponent() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let animationId: number

    async function initWebGPU() {
      if (!canvasRef.current) return

      const canvas = canvasRef.current

      // 获取 adapter
      const adapter = await navigator.gpu?.requestAdapter({
        featureLevel: 'compatibility',
      })

      // 获取 device
      const device = await adapter?.requestDevice()

      if (!device || !adapter) return

      console.log('adapter: ', adapter.info, ' device ', device.adapterInfo)

      // WebGPU Context
      const context = canvas.getContext('webgpu')

      if (!context) {
        throw new Error('WebGPU context unavailable')
      }

      // Retina 适配
      const dpr = window.devicePixelRatio || 1

      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr

      const presentationFormat = navigator.gpu.getPreferredCanvasFormat()

      context.configure({
        device,
        format: presentationFormat,
      })

      // Pipeline
      const pipeline = device.createRenderPipeline({
        layout: 'auto',

        vertex: {
          module: device.createShaderModule({
            code: triangleVertWGSL,
          }),
        },

        fragment: {
          module: device.createShaderModule({
            code: redFragWGSL,
          }),

          targets: [
            {
              format: presentationFormat,
            },
          ],
        },

        primitive: {
          topology: 'triangle-list',
        },
      })

      function frame() {
        const commandEncoder = device.createCommandEncoder()

        const textureView = context.getCurrentTexture().createView()

        const renderPassDescriptor: GPURenderPassDescriptor = {
          colorAttachments: [
            {
              view: textureView,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        }

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor)

        passEncoder.setPipeline(pipeline)

        passEncoder.draw(3)

        passEncoder.end()

        device.queue.submit([commandEncoder.finish()])

        animationId = requestAnimationFrame(frame)
      }

      animationId = requestAnimationFrame(frame)
    }

    initWebGPU()

    return () => {
      cancelAnimationFrame(animationId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      style={{
        display: 'block',
      }}
    />
  )
}
