'use client';

import React, { useEffect, useRef } from 'react';

export function ParticleWave() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = 360);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      height = canvas.height = 360;
    };

    window.addEventListener('resize', handleResize);

    // Particle grid parameters
    const rows = 35;
    const cols = 75;
    const spacingX = width / cols;
    const spacingY = 8;
    let count = 0;

    const render = () => {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, width, height);

      count += 0.012; // Slow animation speed

      for (let ix = 0; ix < cols; ix++) {
        for (let iy = 0; iy < rows; iy++) {
          const x = ix * spacingX + spacingX / 2;
          const yBase = height / 2 + (iy - rows / 2) * spacingY;

          // Sinusoidal wave deformation
          const wave = Math.sin(ix * 0.15 + count) * 20 + Math.cos(iy * 0.2 + count) * 15;
          const y = yBase + wave;

          // Alpha fade out towards edges
          const alpha = Math.max(0.1, 1 - iy / rows) * 0.6;
          const size = Math.max(0.8, (1 - iy / rows) * 2.2);

          ctx.fillStyle = `rgba(0, 128, 0, ${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2, true);
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="w-full relative overflow-hidden my-4 border-y border-white/10">
      <canvas ref={canvasRef} className="w-full block h-[360px]" />
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-[#050505] via-transparent to-[#050505] opacity-60" />
    </div>
  );
}
