import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { mat4 } from 'wgpu-matrix'

import sampleCubemapWGSL from '../shaders/sampleCubemap.wgsl'

export const Route = createFileRoute('/cubemap')({
  component: CubemapDemo,
})

function CubemapDemo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let animationId = 0
    let mounted = true

    async function init() {
      const canvas = canvasRef.current
      if (!canvas) return

      const adapter = await navigator.gpu?.requestAdapter({
        featureLevel: 'compatibility',
      })
      const device = await adapter?.requestDevice()

      const context = canvas.getContext('webgpu')!

      const devicePixelRatio = window.devicePixelRatio
      canvas.width = canvas.clientWidth * devicePixelRatio
      canvas.height = canvas.clientHeight * devicePixelRatio

      const presentationFormat = navigator.gpu.getPreferredCanvasFormat()

      if (!adapter || !device) return

      context.configure({
        device,
        format: presentationFormat,
      })

      const module = device.createShaderModule({ code: sampleCubemapWGSL })

      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module },
        fragment: {
          module,
          targets: [{ format: presentationFormat }],
        },
      })

      // -----------------------
      // Cubemap Texture
      // -----------------------
      const imgSrcs = [
        'assets/img/cubemap/posx.jpg',
        'assets/img/cubemap/negx.jpg',
        'assets/img/cubemap/posy.jpg',
        'assets/img/cubemap/negy.jpg',
        'assets/img/cubemap/posz.jpg',
        'assets/img/cubemap/negz.jpg',
      ]

      const imageBitmaps = await Promise.all(
        imgSrcs.map(async (src) => {
          const res = await fetch(src)
          return createImageBitmap(await res.blob())
        }),
      )

      const cubemapTexture = device.createTexture({
        dimension: '2d',
        textureBindingViewDimension: 'cube',
        size: [imageBitmaps[0].width, imageBitmaps[0].height, 6],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })

      for (let i = 0; i < 6; i++) {
        device.queue.copyExternalImageToTexture(
          { source: imageBitmaps[i] },
          { texture: cubemapTexture, origin: [0, 0, i] },
          [imageBitmaps[i].width, imageBitmaps[i].height],
        )
      }

      // -----------------------
      // Uniform
      // -----------------------
      const uniformBuffer = device.createBuffer({
        size: 4 * 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
          {
            binding: 2,
            resource: cubemapTexture.createView({ dimension: 'cube' }),
          },
        ],
      })

      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: undefined!,
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      }

      // -----------------------
      // Matrices
      // -----------------------
      const aspect = canvas.width / canvas.height
      const projectionMatrix = mat4.perspective(
        (2 * Math.PI) / 5,
        aspect,
        1,
        3000,
      )

      console.log('projectionMatrix', projectionMatrix)

      const modelMatrix = mat4.identity()
      const viewMatrix = mat4.identity()
      const mvpInv = mat4.create()
      const tmp = mat4.create()

      function updateMatrix() {
        // const now = Date.now() / 800
        const now = 1

        mat4.rotate(viewMatrix, [1, 0, 0], (Math.PI / 10) * Math.sin(now), tmp)
        mat4.rotate(tmp, [0, 1, 0], now * 0.2, tmp)

        mat4.multiply(tmp, modelMatrix, mvpInv)
        mat4.multiply(projectionMatrix, mvpInv, mvpInv)
        mat4.inverse(mvpInv, mvpInv)
      }

      function frame() {
        if (!mounted) return

        updateMatrix()

        device.queue.writeBuffer(
          uniformBuffer,
          0,
          mvpInv.buffer,
          mvpInv.byteOffset,
          mvpInv.byteLength,
        )

        renderPassDescriptor.colorAttachments[0].view = context
          .getCurrentTexture()
          .createView()

        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass(renderPassDescriptor)

        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(3)
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
      style={{ display: 'block' }}
    />
  )
}
