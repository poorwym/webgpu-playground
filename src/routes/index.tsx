import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <>
      <div className="w-full h-full bg-amber-300"></div>
    </>
  )
}
