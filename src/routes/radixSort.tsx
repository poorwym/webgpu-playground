import { createFileRoute } from '@tanstack/react-router'

import { useEffect, useMemo, useState } from 'react'

import buildZeroFlagWGSL from '../shaders/radix-sort/buildZeroFlag.wgsl'
import scatterWGSL from '../shaders/radix-sort/scatter.wgsl'
import singleWorkgroupScanWGSL from '../shaders/radix-sort/singleWorkgroupScan.wgsl'

export const Route = createFileRoute('/radixSort')({
  component: RouteComponent,
})

const radixPassCount = 32

type SortState = {
  status: 'running' | 'complete' | 'error'
  result: number[]
  rounds: number[][]
  elapsedMs: number | null
  error: string | null
}

function RouteComponent() {
  const inputValues = useMemo(
    () =>
      Uint32Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 2 ** 12),
      ),
    [],
  )

  const [sortState, setSortState] = useState<SortState>({
    status: 'running',
    result: [],
    rounds: [],
    elapsedMs: null,
    error: null,
  })

  const expectedResult = useMemo(() => {
    return Array.from(inputValues).sort((left, right) => left - right)
  }, [inputValues])

  useEffect(() => {
    let cancelled = false

    async function runRadixSort() {
      const gpu = (
        globalThis.navigator as Navigator & Partial<Record<'gpu', GPU>>
      ).gpu

      if (typeof gpu === 'undefined') {
        setSortState({
          status: 'error',
          result: [],
          rounds: [],
          elapsedMs: null,
          error: 'WebGPU is not available in this browser.',
        })
        return
      }

      const adapter = await gpu.requestAdapter()
      const device = await adapter?.requestDevice()

      if (!adapter || !device) {
        setSortState({
          status: 'error',
          result: [],
          rounds: [],
          elapsedMs: null,
          error: 'Unable to create a WebGPU device.',
        })
        return
      }

      const buffers: GPUBuffer[] = []
      const createBuffer = (descriptor: GPUBufferDescriptor) => {
        const buffer = device.createBuffer(descriptor)
        buffers.push(buffer)
        return buffer
      }

      try {
        const elementCount = inputValues.length
        const dataSize = inputValues.byteLength

        const valueBuffers = [
          createBuffer({
            label: 'radix values a',
            size: dataSize,
            usage:
              GPUBufferUsage.STORAGE |
              GPUBufferUsage.COPY_DST |
              GPUBufferUsage.COPY_SRC,
          }),
          createBuffer({
            label: 'radix values b',
            size: dataSize,
            usage:
              GPUBufferUsage.STORAGE |
              GPUBufferUsage.COPY_DST |
              GPUBufferUsage.COPY_SRC,
          }),
        ]
        const zeroFlagBuffer = createBuffer({
          label: 'radix zero flags',
          size: dataSize,
          usage: GPUBufferUsage.STORAGE,
        })
        const zeroPrefixBuffer = createBuffer({
          label: 'radix zero prefix',
          size: dataSize,
          usage: GPUBufferUsage.STORAGE,
        })
        const metadataBuffer = createBuffer({
          label: 'radix metadata',
          size: Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE,
        })
        const paramsBuffers = Array.from(
          { length: radixPassCount },
          (_, bit) => {
            const params = new Uint32Array([elementCount, bit])
            const buffer = createBuffer({
              label: `radix params bit ${bit}`,
              size: params.byteLength,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
            device.queue.writeBuffer(buffer, 0, params)
            return buffer
          },
        )
        const readbackBuffers = Array.from(
          { length: radixPassCount },
          (_, bit) =>
            createBuffer({
              label: `radix readback bit ${bit}`,
              size: dataSize,
              usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            }),
        )

        device.queue.writeBuffer(valueBuffers[0], 0, inputValues)

        const buildZeroFlagPipeline = device.createComputePipeline({
          label: 'build zero flags',
          layout: 'auto',
          compute: {
            module: device.createShaderModule({ code: buildZeroFlagWGSL }),
            entryPoint: 'main',
          },
        })
        const singleWorkgroupScanPipeline = device.createComputePipeline({
          label: 'single workgroup scan',
          layout: 'auto',
          compute: {
            module: device.createShaderModule({
              code: singleWorkgroupScanWGSL,
            }),
            entryPoint: 'main',
          },
        })
        const scatterPipeline = device.createComputePipeline({
          label: 'scatter',
          layout: 'auto',
          compute: {
            module: device.createShaderModule({ code: scatterWGSL }),
            entryPoint: 'main',
          },
        })

        const encoder = device.createCommandEncoder()

        for (let bit = 0; bit < radixPassCount; bit += 1) {
          const inputBuffer = valueBuffers[bit % 2]
          const outputBuffer = valueBuffers[(bit + 1) % 2]
          const paramsBuffer = paramsBuffers[bit]

          const buildZeroFlagBindGroup = device.createBindGroup({
            layout: buildZeroFlagPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: inputBuffer } },
              { binding: 1, resource: { buffer: zeroFlagBuffer } },
              { binding: 2, resource: { buffer: paramsBuffer } },
            ],
          })
          const singleWorkgroupScanBindGroup = device.createBindGroup({
            layout: singleWorkgroupScanPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: zeroFlagBuffer } },
              { binding: 1, resource: { buffer: zeroPrefixBuffer } },
              { binding: 2, resource: { buffer: metadataBuffer } },
              { binding: 3, resource: { buffer: paramsBuffer } },
            ],
          })
          const scatterBindGroup = device.createBindGroup({
            layout: scatterPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: inputBuffer } },
              { binding: 1, resource: { buffer: zeroFlagBuffer } },
              { binding: 2, resource: { buffer: zeroPrefixBuffer } },
              { binding: 3, resource: { buffer: metadataBuffer } },
              { binding: 4, resource: { buffer: outputBuffer } },
              { binding: 5, resource: { buffer: paramsBuffer } },
            ],
          })

          const buildPass = encoder.beginComputePass()
          buildPass.setPipeline(buildZeroFlagPipeline)
          buildPass.setBindGroup(0, buildZeroFlagBindGroup)
          buildPass.dispatchWorkgroups(Math.ceil(elementCount / 64))
          buildPass.end()

          const scanPass = encoder.beginComputePass()
          scanPass.setPipeline(singleWorkgroupScanPipeline)
          scanPass.setBindGroup(0, singleWorkgroupScanBindGroup)
          scanPass.dispatchWorkgroups(1)
          scanPass.end()

          const scatterPass = encoder.beginComputePass()
          scatterPass.setPipeline(scatterPipeline)
          scatterPass.setBindGroup(0, scatterBindGroup)
          scatterPass.dispatchWorkgroups(Math.ceil(elementCount / 64))
          scatterPass.end()

          encoder.copyBufferToBuffer(
            outputBuffer,
            0,
            readbackBuffers[bit],
            0,
            dataSize,
          )
        }

        const startedAt = performance.now()
        device.queue.submit([encoder.finish()])
        await device.queue.onSubmittedWorkDone()
        const elapsedMs = performance.now() - startedAt

        const rounds: number[][] = []

        for (const readbackBuffer of readbackBuffers) {
          await readbackBuffer.mapAsync(GPUMapMode.READ)
          rounds.push(
            Array.from(new Uint32Array(readbackBuffer.getMappedRange())),
          )
          readbackBuffer.unmap()
        }

        const result = rounds[rounds.length - 1] ?? []

        if (!cancelled) {
          setSortState({
            status: 'complete',
            result,
            rounds,
            elapsedMs,
            error: null,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setSortState({
            status: 'error',
            result: [],
            rounds: [],
            elapsedMs: null,
            error:
              error instanceof Error
                ? error.message
                : 'The radix sort compute pass failed.',
          })
        }
      } finally {
        if (cancelled) {
          buffers.forEach((buffer) => buffer.destroy())
          device.destroy()
        }
      }
    }

    runRadixSort()

    return () => {
      cancelled = true
    }
  }, [inputValues])

  const isCorrect =
    sortState.result.length === expectedResult.length &&
    sortState.result.every((value, index) => value === expectedResult[index])

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="text-sm font-medium text-cyan-300">
            WebGPU compute shader
          </p>
          <h1 className="text-3xl font-semibold">32-pass Radix Sort</h1>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Metric label="Elements" value={inputValues.length.toString()} />
          <Metric label="Passes" value={radixPassCount.toString()} />
          <Metric
            label="Sort time"
            value={
              sortState.elapsedMs === null
                ? 'Running'
                : `${sortState.elapsedMs.toFixed(3)} ms`
            }
          />
        </section>

        {sortState.error ? (
          <section className="rounded border border-red-900 bg-red-950/50 p-4 text-sm text-red-100">
            {sortState.error}
          </section>
        ) : (
          <section className="grid gap-5 lg:grid-cols-2">
            <NumberList title="Input" values={Array.from(inputValues)} />
            <NumberList
              title="Final output"
              values={sortState.result}
              fallback="Waiting for GPU result..."
            />
          </section>
        )}

        {sortState.rounds.length > 0 ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold">Round Results</h2>
            {sortState.rounds.map((values, index) => (
              <NumberList
                key={index}
                title={`Round ${index + 1} - bit ${index}`}
                values={values}
              />
            ))}
          </section>
        ) : null}

        {sortState.status === 'complete' ? (
          <p className="text-sm text-zinc-400">
            Validation: {isCorrect ? 'matched CPU result' : 'mismatch detected'}
          </p>
        ) : null}
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-50">{value}</p>
    </div>
  )
}

function NumberList({
  title,
  values,
  fallback,
}: {
  title: string
  values: number[]
  fallback?: string
}) {
  return (
    <section className="rounded border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {values.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {values.map((value, index) => (
            <span
              key={`${value}-${index}`}
              className="flex h-9 items-center justify-center rounded bg-zinc-800 font-mono text-xs text-zinc-100"
            >
              {value}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-400">{fallback}</p>
      )}
    </section>
  )
}
