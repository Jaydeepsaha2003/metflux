import React, { useEffect, useState } from "react";

const ScatterCardSection = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const cards = [
    {
      id: 1,
      title: "Smart AI Drones",
      image: "https://images.unsplash.com/photo-1504198453319-5ce911bafcde?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Advanced autonomous drones for logistics and surveillance.",
      position: { top: "15%", left: "10%" },
      rotation: "-8deg",
      delay: "0.1s"
    },
    {
      id: 2,
      title: "Robotic Arms",
      image: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "High-precision robotic arms for manufacturing.",
      position: { top: "25%", right: "15%" },
      rotation: "5deg",
      delay: "0.3s"
    },
    {
      id: 3,
      title: "AI-Powered Vehicles",
      image: "https://images.unsplash.com/photo-1575936123452-b67c3203c357?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Smart vehicles equipped with AI for navigation and safety.",
      position: { top: "60%", left: "20%" },
      rotation: "12deg",
      delay: "0.5s"
    },
    {
      id: 4,
      title: "Medical Robots",
      image: "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Robots designed to assist in complex medical procedures.",
      position: { top: "45%", right: "25%" },
      rotation: "-15deg",
      delay: "0.7s"
    },
    {
      id: 5,
      title: "Security Bots",
      image: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Automated security robots for enhanced surveillance.",
      position: { bottom: "10%", left: "50%", transform: "translateX(-50%)" },
      rotation: "3deg",
      delay: "0.9s"
    },
    {
      id: 6,
      title: "Warehouse Robots",
      image: "https://images.unsplash.com/photo-1586953208448-b95a79798f07?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Automated warehouse systems for efficient operations.",
      position: { top: "35%", left: "45%" },
      rotation: "-5deg",
      delay: "1.1s"
    },
    {
      id: 7,
      title: "Humanoid Robots",
      image: "https://images.unsplash.com/photo-1518611012118-696072aa579a?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Advanced humanoid robots for service industries.",
      position: { top: "70%", right: "10%" },
      rotation: "8deg",
      delay: "1.3s"
    },
    {
      id: 8,
      title: "Agricultural Bots",
      image: "https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Precision farming robots for crop monitoring and harvesting.",
      position: { top: "10%", left: "45%" },
      rotation: "-12deg",
      delay: "1.5s"
    },
    {
      id: 9,
      title: "Construction Robots",
      image: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Heavy-duty robots for construction and building automation.",
      position: { top: "55%", right: "5%" },
      rotation: "15deg",
      delay: "1.7s"
    },
    {
      id: 10,
      title: "Cleaning Robots",
      image: "https://images.unsplash.com/photo-1563986768609-322da13575f3?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Automated cleaning solutions for commercial and residential use.",
      position: { bottom: "25%", left: "25%" },
      rotation: "-3deg",
      delay: "1.9s"
    },
    {
      id: 11,
      title: "Space Exploration",
      image: "https://images.unsplash.com/photo-1446776877081-d282a0f896e2?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Advanced rovers and robots for space exploration missions.",
      position: { top: "40%", left: "5%" },
      rotation: "20deg",
      delay: "2.1s"
    },
    {
      id: 12,
      title: "Underwater Robots",
      image: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Submersible robots for ocean research and underwater operations.",
      position: { bottom: "5%", right: "30%" },
      rotation: "-18deg",
      delay: "2.3s"
    },
    {
      id: 13,
      title: "Entertainment Bots",
      image: "https://images.unsplash.com/photo-1507146426996-ef05306b995a?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Interactive robots designed for entertainment and education.",
      position: { top: "80%", left: "60%" },
      rotation: "6deg",
      delay: "2.5s"
    },
    {
      id: 14,
      title: "Rescue Robots",
      image: "https://images.unsplash.com/photo-1582183341606-d5b4a4200ffa?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Emergency response robots for search and rescue operations.",
      position: { top: "30%", right: "40%" },
      rotation: "-25deg",
      delay: "2.7s"
    },
    {
      id: 15,
      title: "Food Service Bots",
      image: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Automated robots for restaurants and food preparation.",
      position: { bottom: "40%", left: "70%" },
      rotation: "10deg",
      delay: "2.9s"
    },
    {
      id: 16,
      title: "Pet Care Robots",
      image: "https://images.unsplash.com/photo-1507146426996-ef05306b995a?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "AI companions for pet care, feeding, and entertainment automation.",
      position: { top: "5%", right: "35%" },
      rotation: "-7deg",
      delay: "3.1s"
    },
    {
      id: 17,
      title: "Mining Robots",
      image: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Heavy-duty robots for deep mining and resource extraction operations.",
      position: { top: "65%", left: "5%" },
      rotation: "18deg",
      delay: "3.3s"
    },
    {
      id: 18,
      title: "Delivery Drones",
      image: "https://images.unsplash.com/photo-1473968512647-3e447244af8f?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Autonomous delivery systems for last-mile logistics and package distribution.",
      position: { top: "20%", left: "75%" },
      rotation: "-22deg",
      delay: "3.5s"
    },
    {
      id: 19,
      title: "Surveillance Bots",
      image: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Advanced security robots with facial recognition and threat detection.",
      position: { top: "85%", right: "45%" },
      rotation: "13deg",
      delay: "3.7s"
    },
    {
      id: 20,
      title: "Laboratory Assistants",
      image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Precision lab robots for research, testing, and sample analysis.",
      position: { bottom: "15%", left: "85%" },
      rotation: "-11deg",
      delay: "3.9s"
    },
    {
      id: 21,
      title: "Transportation Hubs",
      image: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Smart robots managing traffic flow and transportation coordination.",
      position: { top: "50%", left: "80%" },
      rotation: "25deg",
      delay: "4.1s"
    },
    {
      id: 22,
      title: "Textile Manufacturing",
      image: "https://images.unsplash.com/photo-1587613991119-fbbe8e90531d?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Automated weaving and textile production robots with precision stitching.",
      position: { top: "15%", right: "5%" },
      rotation: "-16deg",
      delay: "4.3s"
    },
    {
      id: 23,
      title: "Elder Care Assistants",
      image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Compassionate robots providing healthcare support for elderly patients.",
      position: { bottom: "60%", right: "15%" },
      rotation: "8deg",
      delay: "4.5s"
    },
    {
      id: 24,
      title: "Weather Monitoring",
      image: "https://images.unsplash.com/photo-1504711434969-e33886168f5c?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Autonomous weather stations with real-time atmospheric data collection.",
      position: { top: "75%", left: "40%" },
      rotation: "-28deg",
      delay: "4.7s"
    },
    {
      id: 25,
      title: "Automotive Assembly",
      image: "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "High-speed robotic arms for automotive manufacturing and assembly lines.",
      position: { top: "45%", left: "15%" },
      rotation: "14deg",
      delay: "4.9s"
    },
    {
      id: 26,
      title: "Forest Conservation",
      image: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Environmental robots for reforestation and wildlife protection monitoring.",
      position: { bottom: "30%", right: "60%" },
      rotation: "19deg",
      delay: "5.1s"
    },
    {
      id: 27,
      title: "Nuclear Maintenance",
      image: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Radiation-resistant robots for nuclear facility maintenance and inspection.",
      position: { top: "35%", right: "70%" },
      rotation: "-30deg",
      delay: "5.3s"
    },
    {
      id: 28,
      title: "Sports Training",
      image: "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "AI-powered robots for athletic training and performance analysis.",
      position: { bottom: "70%", left: "30%" },
      rotation: "12deg",
      delay: "5.5s"
    },
    {
      id: 29,
      title: "Disaster Response",
      image: "https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Emergency robots designed for natural disaster relief and recovery operations.",
      position: { top: "90%", left: "15%" },
      rotation: "-14deg",
      delay: "5.7s"
    },
    {
      id: 30,
      title: "Art & Design Bots",
      image: "https://images.unsplash.com/photo-1561736778-92e52a7769ef?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80",
      description: "Creative robots capable of painting, sculpting, and digital art generation.",
      position: { top: "60%", right: "50%" },
      rotation: "23deg",
      delay: "5.9s"
    }
  ];

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 300);
    
    return () => clearTimeout(timer);
  }, []);

  const handleCardClick = (card) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setTimeout(() => {
      setSelectedCard(null);
    }, 300);
  };

  const handleSelectCard = () => {
    alert(`You selected: ${selectedCard?.title}`);
    handleCloseModal();
  };

  const handleMouseMove = (event) => {
    setMousePosition({ x: event.clientX, y: event.clientY });
  };

  const handleCardMouseEnter = (event, card) => {
    setHoveredCard(card);
    setMousePosition({ x: event.clientX, y: event.clientY });
  };

  const handleCardMouseLeave = () => {
    setHoveredCard(null);
  };

  return (
    <section className="w-full py-16 md:py-24 bg-gradient-to-br from-gray-50 to-gray-100 relative overflow-hidden min-h-screen">
      {/* Section Header */}
      <div className="text-center mb-16 relative z-10">
        <div className="flex items-center justify-center gap-4 mb-6">
          <div className="pulse-chip opacity-0 animate-fade-in" style={{
            animationDelay: "0.1s"
          }}>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">10</span>
            <span>Gallery</span>
          </div>
        </div>
        
        <h2 className="section-title text-3xl sm:text-4xl md:text-5xl font-display font-bold mb-6 text-gray-900 opacity-0 animate-fade-in" style={{
          animationDelay: "0.2s"
        }}>
          Robot Showcase
        </h2>
        <p className="text-lg text-gray-600 max-w-3xl mx-auto opacity-0 animate-fade-in" style={{
          animationDelay: "0.3s"
        }}>
          Explore our diverse collection of cutting-edge robotic solutions
        </p>
      </div>

      {/* Scattered Cards */}
      <div className="container mx-auto h-screen relative px-4">
        {cards.map((card) => (
          <div 
            key={card.id} 
            className={`group absolute w-64 bg-white rounded-2xl shadow-xl transition-all duration-700 ease-out hover:scale-105 hover:shadow-2xl hover:z-20 cursor-pointer ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
            style={{
              ...card.position,
              transform: `${card.position.transform || ''} rotate(${card.rotation})`,
              transitionDelay: card.delay,
              zIndex: 5
            }}
            onClick={() => handleCardClick(card)}
            onMouseEnter={(e) => handleCardMouseEnter(e, card)}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleCardMouseLeave}
          >
            {/* Image */}
            <div className="relative overflow-hidden rounded-t-2xl">
              <img 
                src={card.image} 
                alt={card.title} 
                className="w-full h-40 object-cover transition-transform duration-500 hover:scale-110" 
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
            </div>
            
            {/* Content */}
            <div className="p-4">
              <h3 className="text-lg font-bold text-gray-900 mb-2">{card.title}</h3>
              <p className="text-gray-600 text-xs leading-relaxed">{card.description}</p>
              
              {/* Hover Action */}
              <div className="mt-3 opacity-0 transition-opacity duration-300 hover:opacity-100">
                <button className="text-pulse-500 hover:text-pulse-600 text-xs font-medium flex items-center gap-1">
                  Learn More
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Mouse-following Tooltip */}
      {hoveredCard && (
        <div 
          className="fixed pointer-events-none z-40 bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg whitespace-nowrap transition-all duration-75"
          style={{
            left: mousePosition.x + 15,
            top: mousePosition.y - 40,
            transform: 'translate(0, 0)'
          }}
        >
          {hoveredCard.title}
          <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
        </div>
      )}

      {/* Background Decorations */}
      <div className="absolute top-20 left-10 w-32 h-32 bg-pulse-500/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-20 right-10 w-40 h-40 bg-pulse-300/10 rounded-full blur-3xl"></div>
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-pulse-400/5 rounded-full blur-3xl"></div>

      {/* Modal Overlay */}
      {isModalOpen && selectedCard && (
        <div 
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${
            isModalOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          style={{
            backdropFilter: 'blur(10px)',
            backgroundColor: 'rgba(0, 0, 0, 0.5)'
          }}
          onClick={handleCloseModal}
        >
          <div 
            className={`bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto transform transition-all duration-300 ${
              isModalOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button 
              onClick={handleCloseModal}
              className="absolute top-4 right-4 z-10 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full shadow-lg flex items-center justify-center hover:bg-white transition-all duration-200 hover:scale-110"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Modal Image */}
            <div className="relative overflow-hidden rounded-t-3xl">
              <img 
                src={selectedCard.image} 
                alt={selectedCard.title} 
                className="w-full h-64 md:h-80 object-cover" 
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent"></div>
              
              {/* Overlay Title */}
              <div className="absolute bottom-6 left-6 right-6">
                <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
                  {selectedCard.title}
                </h2>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6 md:p-8">
              <p className="text-gray-700 text-lg leading-relaxed mb-6">
                {selectedCard.description}
              </p>
              
              {/* Additional Details */}
              <div className="space-y-4 mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-pulse-500 rounded-full"></div>
                  <span className="text-gray-600">Advanced AI-powered technology</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-pulse-500 rounded-full"></div>
                  <span className="text-gray-600">Industry-leading precision and reliability</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-pulse-500 rounded-full"></div>
                  <span className="text-gray-600">24/7 autonomous operation capability</span>
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button 
                  onClick={handleSelectCard}
                  className="flex-1 bg-pulse-500 hover:bg-pulse-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 transform hover:scale-105"
                >
                  Select This Robot
                </button>
                <button 
                  onClick={handleCloseModal}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-xl transition-all duration-200"
                >
                  Continue Browsing
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default ScatterCardSection;

