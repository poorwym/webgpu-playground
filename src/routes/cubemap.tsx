import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/cubemap')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/cubemap"!</div>
}
