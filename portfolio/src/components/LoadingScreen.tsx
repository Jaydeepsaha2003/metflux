import siteData from "@/data/siteData";
import React, { useEffect, useState } from "react";

interface LoadingScreenProps {
  onLoadingComplete: () => void;
  duration?: number;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ 
  onLoadingComplete, 
  duration = 500
}) => {
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        const increment = 100 / (duration / 50); // Update every 50ms
        const newProgress = prev + increment;
        
        if (newProgress >= 100) {
          clearInterval(interval);
          // Start fade out animation
          setTimeout(() => {
            setIsVisible(false);
            // Complete loading after fade animation
            setTimeout(onLoadingComplete, 500);
          }, 200);
          return 100;
        }
        
        return newProgress;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [duration, onLoadingComplete]);

  const circumference = 2 * Math.PI * 45; // radius of 45
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 transition-opacity duration-500 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='m36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Main Content */}
      <div className="relative flex flex-col items-center space-y-8">
        {/* Logo with Progress Ring */}
        <div className="relative">
          {/* Progress Ring */}
          <svg
            className="transform -rotate-90 w-32 h-32"
            viewBox="0 0 100 100"
          >
            {/* Background Circle */}
            <circle
              cx="50"
              cy="50"
              r="45"
              stroke="rgba(255, 255, 255, 0.1)"
              strokeWidth="3"
              fill="none"
            />
            {/* Progress Circle */}
            <circle
              cx="50"
              cy="50"
              r="45"
              stroke="url(#progressGradient)"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-100 ease-out"
              style={{
                filter: "drop-shadow(0 0 8px rgba(44, 171, 74, 0.6))",
              }}
            />
            <defs>
              <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#16a34a" />
                <stop offset="50%" stopColor="#2cab4a" />
                <stop offset="100%" stopColor="#15803d" />
              </linearGradient>
            </defs>
          </svg>

          {/* Logo in Center */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-white rounded-full p-4 shadow-lg">
              <img
                src={siteData.site.logo} alt={`${siteData.site.name} Logo`}
                className="h-12 w-12 object-contain"
              />
            </div>
          </div>
        </div>

        {/* Company Info */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">{siteData.site.name}</h1>
          <p className="text-pulse-400 text-lg font-medium">Electrical Excellence</p>
          <p className="text-gray-400 text-sm max-w-md">
            Powering progress with precision electrical solutions
          </p>
        </div>

        {/* Progress Percentage */}
        <div className="text-center">
          <div className="text-2xl font-bold text-white mb-2">
            {Math.round(progress)}%
          </div>
          <div className="text-gray-400 text-sm">Loading...</div>
        </div>

        {/* Loading Animation Dots */}
        <div className="flex space-x-2">
          <div className="w-2 h-2 bg-pulse-500 rounded-full animate-bounce"></div>
          <div className="w-2 h-2 bg-pulse-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
          <div className="w-2 h-2 bg-pulse-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
        </div>
      </div>

      {/* Floating Particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(15)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-pulse-400 rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default LoadingScreen;
