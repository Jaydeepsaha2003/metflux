import React from "react";

interface BadgeProps {
  icon?: string;
  text: string;
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({ icon, text, className = "" }) => {
  return (
    <div className={`pulse-chip mx-auto mb-4 ${className}`}>
      {icon && (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">
          {icon}
        </span>
      )}
      <span>{text}</span>
    </div>
  );
};

export default Badge;

