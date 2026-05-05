import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/computeShader')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/computeShader"!</div>
}
