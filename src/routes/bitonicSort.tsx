import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/bitonicSort')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/bitonicSort"!</div>
}
