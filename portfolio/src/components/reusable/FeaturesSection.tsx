import React, { useEffect, useRef } from "react";
import Section from "./Section";
import SectionHeader from "./SectionHeader";
import FeatureCard from "./FeatureCard";

interface FeatureItem {
  icon?: string;
  title: string;
  description: string;
}

interface FeaturesData {
  badge?: {
    icon?: string;
    text: string;
  };
  title: string;
  subtitle?: string;
  description?: string;
  items: FeatureItem[];
}

interface FeaturesSectionProps {
  data: FeaturesData;
  backgroundClass?: string;
  className?: string;
  id?: string;
}

const FeaturesSection: React.FC<FeaturesSectionProps> = ({
  data,
  backgroundClass = "bg-gray-50",
  className = "",
  id
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const meteors: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      opacity: number;
      trail: Array<{ x: number; y: number }>;
    }> = [];
    let animationId: number;
    let lastMeteorTime = 0;

    // Set canvas size
    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const createMeteor = () => {
      const meteor = {
        x: Math.random() * canvas.width + 100,
        y: -50 - Math.random() * 100,
        vx: -(2 + Math.random() * 3),
        vy: 2 + Math.random() * 3,
        size: Math.random() * 2 + 1,
        opacity: 0.5 + Math.random() * 0.5,
        trail: []
      };
      meteors.push(meteor);
    };

    const animate = (currentTime: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Create new meteors
      if (currentTime - lastMeteorTime > 300 + Math.random() * 500) {
        createMeteor();
        lastMeteorTime = currentTime;
      }

      // Update meteors
      for (let i = meteors.length - 1; i >= 0; i--) {
        const meteor = meteors[i];
        
        meteor.x += meteor.vx;
        meteor.y += meteor.vy;

        // Add trail
        meteor.trail.push({ x: meteor.x, y: meteor.y });
        if (meteor.trail.length > 8) {
          meteor.trail.shift();
        }

        // Draw trail
        meteor.trail.forEach((point: { x: number; y: number }, index: number) => {
          const trailOpacity = (index / meteor.trail.length) * meteor.opacity * 0.3;
          const trailSize = meteor.size * (index / meteor.trail.length) * 0.5;
          
          ctx.save();
          ctx.globalAlpha = trailOpacity;
          ctx.fillStyle = '#2cab4a';
          ctx.beginPath();
          ctx.arc(point.x, point.y, trailSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });

        // Draw meteor
        ctx.save();
        ctx.globalAlpha = meteor.opacity;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#2cab4a';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(meteor.x, meteor.y, meteor.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Remove meteors that are off screen
        if (meteor.x < -100 || meteor.y > canvas.height + 100) {
          meteors.splice(i, 1);
        }
      }

      animationId = requestAnimationFrame(animate);
    };

    animate(0);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, []);

  return (
    <Section
      id={id}
      backgroundClass={backgroundClass}
      className={className}
    >
      <SectionHeader
        badge={data.badge}
        title={data.title}
        subtitle={data.subtitle}
        description={data.description}
      />

      <div ref={containerRef} className="absolute inset-0 pointer-events-none">
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 opacity-0 fade-in-element">
        {data.items.map((feature, index) => (
          <FeatureCard
            key={index}
            icon={feature.icon}
            title={feature.title}
            description={feature.description}
          />
        ))}
      </div>
    </Section>
  );
};

export default FeaturesSection;
