# scripts/rembg_stdin.py
# Robust stdin→remove()→stdout wrapper. Emits errors to stderr and exits non-zero.

import sys
from rembg import remove

def main():
    try:
        data = sys.stdin.buffer.read()
        if not data:
            sys.stderr.write("stdin_empty\n")
            sys.exit(1)

        out = remove(data)  # PNG bytes with alpha
        if not out:
            sys.stderr.write("remove_returned_empty\n")
            sys.exit(2)

        sys.stdout.buffer.write(out)
        sys.stdout.flush()
        sys.exit(0)

    except Exception as e:
        sys.stderr.write(f"exception:{e}\n")
        sys.exit(3)

if __name__ == "__main__":
    main()