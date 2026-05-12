declare module '*.wgsl' {
  const source: string
  export default source
}
declare module 'teapot' {
  const teapotData: {
    positions: [number, number, number][]
    cells: [number, number, number][]
  }

  export default teapotData
}
