import * as React from 'react'
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'webgpu-playground' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
})

function RootComponent() {
  return (
    <div id="__root__" className="h-screen w-screen">
      <Outlet />
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function NotFoundComponent() {
  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-stone-950 px-6 text-stone-50">
      <p className="text-sm uppercase tracking-[0.3em] text-stone-400">404</p>
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="max-w-md text-center text-sm text-stone-300">
        The route does not exist in this playground.
      </p>
      <Link
        to="/"
        className="rounded border border-stone-700 px-4 py-2 text-sm transition hover:border-stone-500 hover:bg-stone-900"
      >
        Back to home
      </Link>
    </main>
  )
}
