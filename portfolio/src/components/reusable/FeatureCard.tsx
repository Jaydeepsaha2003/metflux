import React from "react";

interface FeatureCardProps {
  icon?: string;
  title: string;
  description: string;
  className?: string;
}

const FeatureCard: React.FC<FeatureCardProps> = ({
  icon,
  title,
  description,
  className = ""
}) => {
  return (
    <div className={`bg-white rounded-2xl p-6 sm:p-8 shadow-elegant hover:shadow-elegant-hover transition-shadow duration-300 ${className}`}>
      {icon && (
        <div className="text-4xl mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-xl sm:text-2xl font-display font-bold text-gray-900 mb-3 sm:mb-4">
        {title}
      </h3>
      <p className="text-gray-600 leading-relaxed">
        {description}
      </p>
    </div>
  );
};

export default FeatureCard;
