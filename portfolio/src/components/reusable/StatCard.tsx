import React from "react";

interface StatCardProps {
  value: string;
  label: string;
  description?: string;
  className?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  value,
  label,
  description,
  className = ""
}) => {
  return (
    <div className={`text-center ${className}`}>
      <div className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-pulse-600 mb-2">
        {value}
      </div>
      <div className="text-gray-600 font-medium mb-1">
        {label}
      </div>
      {description && (
        <div className="text-sm text-gray-500">
          {description}
        </div>
      )}
    </div>
  );
};

export default StatCard;
