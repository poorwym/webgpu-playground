import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { mat4 } from 'wgpu-matrix'

import particleWGSL from '../shaders/particles/particles.wgsl'
import probabilityMapWGSL from '../shaders/particles/probabilityMap.wgsl'

export const Route = createFileRoute('/particles')({
  component: Particles,
})

const numParticles = 50_000
const particlePositionOffset = 0
const particleColorOffset = 4 * 4
const particleInstanceByteSize =
  3 * 4 + // position
  1 * 4 + // lifetime
  4 * 4 + // color
  3 * 4 + // velocity
  1 * 4 // padding

type ToneMappingMode = GPUCanvasToneMappingMode

type SimulationParams = {
  simulate: boolean
  deltaTime: number
  toneMappingMode: ToneMappingMode
  brightnessFactor: number
}

function Particles() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const configureContextRef = useRef<(() => void) | null>(null)
  const paramsRef = useRef<SimulationParams>({
    simulate: true,
    deltaTime: 0.04,
    toneMappingMode: 'standard',
    brightnessFactor: 1,
  })
  const [simulate, setSimulate] = useState(paramsRef.current.simulate)
  const [deltaTime, setDeltaTime] = useState(paramsRef.current.deltaTime)
  const [toneMappingMode, setToneMappingMode] = useState<ToneMappingMode>(
    paramsRef.current.toneMappingMode,
  )
  const [brightnessFactor, setBrightnessFactor] = useState(
    paramsRef.current.brightnessFactor,
  )
  const [hdrMessage, setHdrMessage] = useState('HDR settings')

  useEffect(() => {
    paramsRef.current = {
      simulate,
      deltaTime,
      toneMappingMode,
      brightnessFactor,
    }
  }, [simulate, deltaTime, toneMappingMode, brightnessFactor])

  useEffect(() => {
    configureContextRef.current?.()
  }, [toneMappingMode])

  useEffect(() => {
    let mounted = true
    let animationId = 0
    let device: GPUDevice | undefined
    let context: GPUCanvasContext | null = null

    async function init() {
      const canvas = canvasRef.current
      if (!canvas) return

      const adapter = await navigator.gpu.requestAdapter({
        featureLevel: 'compatibility',
      })

      if (!adapter) {
        console.error('WebGPU adapter unavailable')
        return
      }

      device = await adapter.requestDevice()
      if (!mounted) {
        device.destroy()
        return
      }

      context = canvas.getContext('webgpu')
      if (!context) {
        console.error('WebGPU context unavailable')
        return
      }

      const presentationFormat = 'rgba16float' as GPUTextureFormat

      const resizeCanvas = () => {
        const dpr = window.devicePixelRatio || 1
        const width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
        const height = Math.max(1, Math.floor(canvas.clientHeight * dpr))

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
      }

      const getHdrFolderName = () => {
        if (!window.matchMedia('(dynamic-range: high)').matches) {
          return "HDR settings - display isn't compatible"
        }
        if (!('getConfiguration' in GPUCanvasContext.prototype)) {
          return 'HDR settings'
        }
        if (
          paramsRef.current.toneMappingMode === 'extended' &&
          context?.getConfiguration().toneMapping?.mode !== 'extended'
        ) {
          return "HDR settings - browser doesn't support HDR canvas"
        }
        return 'HDR settings'
      }

      configureContextRef.current = () => {
        if (!device || !context) return

        resizeCanvas()
        context.configure({
          device,
          format: presentationFormat,
          toneMapping: { mode: paramsRef.current.toneMappingMode },
        })
        setHdrMessage(getHdrFolderName())
      }

      configureContextRef.current()

      const hdrMediaQuery = window.matchMedia('(dynamic-range: high)')
      const updateHdrMessage = () => setHdrMessage(getHdrFolderName())
      hdrMediaQuery.addEventListener('change', updateHdrMessage)

      const particlesBuffer = device.createBuffer({
        size: numParticles * particleInstanceByteSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
      })

      const renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: device.createShaderModule({ code: particleWGSL }),
          entryPoint: 'vs_main',
          buffers: [
            {
              arrayStride: particleInstanceByteSize,
              stepMode: 'instance',
              attributes: [
                {
                  shaderLocation: 0,
                  offset: particlePositionOffset,
                  format: 'float32x3',
                },
                {
                  shaderLocation: 1,
                  offset: particleColorOffset,
                  format: 'float32x4',
                },
              ],
            },
            {
              arrayStride: 2 * 4,
              stepMode: 'vertex',
              attributes: [
                {
                  shaderLocation: 2,
                  offset: 0,
                  format: 'float32x2',
                },
              ],
            },
          ],
        },
        fragment: {
          module: device.createShaderModule({ code: particleWGSL }),
          entryPoint: 'fs_main',
          targets: [
            {
              format: presentationFormat,
              blend: {
                color: {
                  srcFactor: 'src-alpha',
                  dstFactor: 'one',
                  operation: 'add',
                },
                alpha: {
                  srcFactor: 'zero',
                  dstFactor: 'one',
                  operation: 'add',
                },
              },
            },
          ],
        },
        primitive: {
          topology: 'triangle-list',
        },
        depthStencil: {
          depthWriteEnabled: false,
          depthCompare: 'less',
          format: 'depth24plus',
        },
      })

      let depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })

      const uniformBufferSize =
        4 * 4 * 4 + // modelViewProjectionMatrix
        3 * 4 +
        4 + // right + padding
        3 * 4 +
        4 // up + padding

      const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      const uniformBindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      })

      const quadVertexBuffer = device.createBuffer({
        size: 6 * 2 * 4,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      })
      new Float32Array(quadVertexBuffer.getMappedRange()).set([
        -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
      ])
      quadVertexBuffer.unmap()

      const texture = await createParticleTexture(device)
      if (!canvasRef.current) return

      createProbabilityMap(device, texture)

      const simulationUBOBufferSize =
        1 * 4 + // deltaTime
        1 * 4 + // brightnessFactor
        2 * 4 + // padding
        4 * 4 // seed

      const simulationUBOBuffer = device.createBuffer({
        size: simulationUBOBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      const computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: device.createShaderModule({ code: particleWGSL }),
          entryPoint: 'simulate',
        },
      })

      const computeBindGroup = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: simulationUBOBuffer } },
          { binding: 1, resource: { buffer: particlesBuffer } },
          { binding: 2, resource: texture.createView() },
        ],
      })

      const view = mat4.create()
      const mvp = mat4.create()
      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: [0, 0, 0, 1],
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depthTexture.createView({
            label: 'Depth texture view',
          }),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      }

      const frame = () => {
        if (!mounted || !device || !context) return

        const previousWidth = canvas.width
        const previousHeight = canvas.height
        resizeCanvas()

        if (
          canvas.width !== previousWidth ||
          canvas.height !== previousHeight
        ) {
          configureContextRef.current?.()
          depthTexture.destroy()
          depthTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          })
          renderPassDescriptor.depthStencilAttachment!.view =
            depthTexture.createView({
              label: 'Depth texture view',
            })
        }

        renderPassDescriptor.colorAttachments[0].view = context
          .getCurrentTexture()
          .createView()

        const params = paramsRef.current
        const uboDataF32 = new Float32Array(simulationUBOBuffer.size / 4)
        const uboDataU32 = new Uint32Array(uboDataF32.buffer)
        uboDataF32[0] = params.simulate ? params.deltaTime : 0
        uboDataF32[1] = params.brightnessFactor
        uboDataU32[4] = 0xffffffff * Math.random()
        uboDataU32[5] = 0xffffffff * Math.random()
        uboDataU32[6] = 0xffffffff * Math.random()
        uboDataU32[7] = 0xffffffff * Math.random()

        device.queue.writeBuffer(simulationUBOBuffer, 0, uboDataF32)

        const aspect = canvas.width / canvas.height
        const projection = mat4.perspective((2 * Math.PI) / 5, aspect, 1, 100)
        mat4.identity(view)
        mat4.translate(view, [0, 0, -3], view)
        mat4.rotateX(view, Math.PI * -0.2, view)
        mat4.multiply(projection, view, mvp)

        device.queue.writeBuffer(
          uniformBuffer,
          0,
          new Float32Array([
            mvp[0],
            mvp[1],
            mvp[2],
            mvp[3],
            mvp[4],
            mvp[5],
            mvp[6],
            mvp[7],
            mvp[8],
            mvp[9],
            mvp[10],
            mvp[11],
            mvp[12],
            mvp[13],
            mvp[14],
            mvp[15],
            view[0],
            view[4],
            view[8],
            0,
            view[1],
            view[5],
            view[9],
            0,
          ]),
        )

        const commandEncoder = device.createCommandEncoder()
        const computePass = commandEncoder.beginComputePass()
        computePass.setPipeline(computePipeline)
        computePass.setBindGroup(0, computeBindGroup)
        computePass.dispatchWorkgroups(Math.ceil(numParticles / 64))
        computePass.end()

        const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor)

        renderPass.setPipeline(renderPipeline)
        renderPass.setBindGroup(0, uniformBindGroup)
        renderPass.setVertexBuffer(0, particlesBuffer)
        renderPass.setVertexBuffer(1, quadVertexBuffer)
        renderPass.draw(6, numParticles)
        renderPass.end()

        device.queue.submit([commandEncoder.finish()])
        animationId = requestAnimationFrame(frame)
      }

      frame()

      return () => {
        hdrMediaQuery.removeEventListener('change', updateHdrMessage)
      }
    }

    let removeListeners: (() => void) | undefined
    init().then((cleanup) => {
      removeListeners = cleanup
    })

    return () => {
      mounted = false
      configureContextRef.current = null
      removeListeners?.()
      cancelAnimationFrame(animationId)
      device?.destroy()
    }
  }, [])

  return (
    <div className="relative h-full w-full bg-black">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <form className="absolute left-4 top-4 grid w-72 gap-3 rounded bg-black/70 p-4 text-sm text-white shadow-lg backdrop-blur">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={simulate}
            onChange={(event) => setSimulate(event.currentTarget.checked)}
          />
          Simulate
        </label>

        <label className="grid gap-1">
          <span>Delta time: {deltaTime.toFixed(2)}</span>
          <input
            type="range"
            min="0"
            max="0.1"
            step="0.01"
            value={deltaTime}
            onChange={(event) =>
              setDeltaTime(Number(event.currentTarget.value))
            }
          />
        </label>

        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium">{hdrMessage}</legend>
          <label className="grid gap-1">
            <span>Tone mapping</span>
            <select
              className="rounded bg-zinc-900 p-1 text-white"
              value={toneMappingMode}
              onChange={(event) =>
                setToneMappingMode(event.currentTarget.value as ToneMappingMode)
              }
            >
              <option value="standard">standard</option>
              <option value="extended">extended</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span>Brightness: {brightnessFactor.toFixed(1)}</span>
            <input
              type="range"
              min="0"
              max="4"
              step="0.1"
              value={brightnessFactor}
              onChange={(event) =>
                setBrightnessFactor(Number(event.currentTarget.value))
              }
            />
          </label>
        </fieldset>
      </form>
    </div>
  )
}

async function createParticleTexture(device: GPUDevice) {
  const response = await fetch('/assets/img/webgpu.png')
  const imageBitmap = await createImageBitmap(await response.blob())

  const mipLevelCount =
    (Math.log2(Math.max(imageBitmap.width, imageBitmap.height)) + 1) | 0
  const texture = device.createTexture({
    size: [imageBitmap.width, imageBitmap.height, 1],
    mipLevelCount,
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })

  device.queue.copyExternalImageToTexture(
    { source: imageBitmap },
    { texture },
    [imageBitmap.width, imageBitmap.height],
  )

  return texture
}

function createProbabilityMap(device: GPUDevice, texture: GPUTexture) {
  const probabilityMapImportLevelPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: probabilityMapWGSL }),
      entryPoint: 'import_level',
    },
  })
  const probabilityMapExportLevelPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: probabilityMapWGSL }),
      entryPoint: 'export_level',
    },
  })

  const probabilityMapUBOBuffer = device.createBuffer({
    size: 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const bufferA = device.createBuffer({
    size: texture.width * texture.height * 4,
    usage: GPUBufferUsage.STORAGE,
  })
  const bufferB = device.createBuffer({
    size: bufferA.size,
    usage: GPUBufferUsage.STORAGE,
  })

  device.queue.writeBuffer(
    probabilityMapUBOBuffer,
    0,
    new Uint32Array([texture.width]),
  )

  const commandEncoder = device.createCommandEncoder()

  for (let level = 0; level < texture.mipLevelCount; level++) {
    const levelWidth = Math.max(1, texture.width >> level)
    const levelHeight = Math.max(1, texture.height >> level)
    const bindGroupLayout =
      level === 0
        ? probabilityMapImportLevelPipeline.getBindGroupLayout(0)
        : probabilityMapExportLevelPipeline.getBindGroupLayout(0)
    const probabilityMapBindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: probabilityMapUBOBuffer },
        },
        {
          binding: 1,
          resource: { buffer: level & 1 ? bufferA : bufferB },
        },
        {
          binding: 2,
          resource: { buffer: level & 1 ? bufferB : bufferA },
        },
        {
          binding: 3,
          resource: texture.createView({
            label: 'Probability map view',
            format: 'rgba8unorm',
            dimension: '2d',
            baseMipLevel: level,
            mipLevelCount: 1,
          }),
        },
      ],
    })

    const passEncoder = commandEncoder.beginComputePass()
    passEncoder.setPipeline(
      level === 0
        ? probabilityMapImportLevelPipeline
        : probabilityMapExportLevelPipeline,
    )
    passEncoder.setBindGroup(0, probabilityMapBindGroup)
    passEncoder.dispatchWorkgroups(Math.ceil(levelWidth / 64), levelHeight)
    passEncoder.end()
  }

  device.queue.submit([commandEncoder.finish()])
}
