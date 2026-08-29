"""Entry point for the backend bundled with the desktop application."""

import argparse

import uvicorn

from backend.server import app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()
    uvicorn.run(app, host=arguments.host, port=arguments.port)


if __name__ == "__main__":
    main()
