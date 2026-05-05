default:
    @just --list

wasm-compile:
    wasm-pack build ./wasm/scan --target web --out-dir ../../packages/scan-wasm
    rm -f packages/scan-wasm/.gitignore
