# Project guidance

- Worlds are seed-dependent. Whenever practical, derive randomized gameplay, generation, motion, and persistent visual details from the world seed rather than `Math.random()`.
- Use separate deterministic RNG streams for independent systems so adding random draws in one system does not perturb another.
- Unseeded randomness is acceptable only for ephemeral, non-authoritative presentation effects whose exact result does not define or persist with the world.
