import React from "react";
import Image from "next/image";

const AlternatingStrips = () => {
  return (
    <section className="w-full bg-gray-50" id="alternating-strips">
      {/* Strip 1 - Left aligned overlay */}
      <div className="w-full py-8">
        <div className="container px-6 lg:px-8 mx-auto">
          <div className="max-w-5xl mx-auto">
            <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden shadow-elegant">
              <div className="relative h-72 md:h-[360px] lg:h-[450px]">
                <Image
                  src="/lovable-uploads/c3d5522b-6886-4b75-8ffc-d020016bb9c2.png" 
                  alt="Advanced humanoid robot showcasing future technology" 
                  fill
                  className="object-cover"
                />
                
                <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent"></div>
                
                {/* Left aligned text overlay */}
                <div className="absolute inset-0 flex items-center justify-start p-6 md:p-12">
                  <div className="bg-white/30 backdrop-blur-sm rounded-2xl p-6 md:p-8 max-w-lg shadow-2xl border border-white/20">
                    <div className="text-left space-y-4">
                      <div className="inline-flex items-center justify-center w-12 h-12 bg-pulse-500 rounded-full mb-3">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      
                      <h3 className="text-xl md:text-2xl font-display font-bold text-white drop-shadow-lg">
                        AI-Powered Innovation
                      </h3>
                      
                      <p className="text-white text-sm md:text-base leading-relaxed drop-shadow-md">
                        Revolutionary artificial intelligence that adapts and learns from every interaction.
                      </p>
                      
                      <button className="button-primary text-sm px-4 py-2">
                        Learn More
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strip 2 - Right aligned overlay */}
      <div className="w-full py-8">
        <div className="container px-6 lg:px-8 mx-auto">
          <div className="max-w-5xl mx-auto">
            <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden shadow-elegant">
              <div className="relative h-72 md:h-[360px] lg:h-[450px]">
                <Image
                  src="/lovable-uploads/c3d5522b-6886-4b75-8ffc-d020016bb9c2.png" 
                  alt="Precision engineering in robotics" 
                  fill
                  className="object-cover"
                />
                
                <div className="absolute inset-0 bg-gradient-to-l from-black/70 via-black/30 to-transparent"></div>
                
                {/* Right aligned text overlay */}
                <div className="absolute inset-0 flex items-center justify-end p-6 md:p-12">
                  <div className="bg-white/30 backdrop-blur-sm rounded-2xl p-6 md:p-8 max-w-lg shadow-2xl border border-white/20">
                    <div className="text-right space-y-4">
                      <div className="inline-flex items-center justify-center w-12 h-12 bg-pulse-500 rounded-full mb-3 ml-auto">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      
                      <h3 className="text-xl md:text-2xl font-display font-bold text-white drop-shadow-lg">
                        Precision Engineering
                      </h3>
                      
                      <p className="text-white text-sm md:text-base leading-relaxed drop-shadow-md">
                        Sub-millimeter accuracy for the most demanding industrial applications.
                      </p>
                      
                      <button className="button-secondary text-sm px-4 py-2">
                        View Specs
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strip 3 - Center aligned overlay */}
      <div className="w-full py-8">
        <div className="container px-6 lg:px-8 mx-auto">
          <div className="max-w-5xl mx-auto">
            <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden shadow-elegant">
              <div className="relative h-72 md:h-[360px] lg:h-[450px]">
                <Image
                  src="/lovable-uploads/c3d5522b-6886-4b75-8ffc-d020016bb9c2.png" 
                  alt="Seamless integration technology" 
                  fill
                  className="object-cover"
                />
                
                <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/60 to-black/50"></div>
                
                {/* Center aligned text overlay */}
                <div className="absolute inset-0 flex items-center justify-center p-6 md:p-12">
                  <div className="bg-white/30 backdrop-blur-sm rounded-2xl p-6 md:p-8 max-w-2xl shadow-2xl border border-white/20">
                    <div className="text-center space-y-4">
                      <div className="inline-flex items-center justify-center w-12 h-12 bg-pulse-500 rounded-full mb-3">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                      </div>
                      
                      <h3 className="text-xl md:text-2xl font-display font-bold text-white drop-shadow-lg">
                        Seamless Integration
                      </h3>
                      
                      <p className="text-white text-sm md:text-base leading-relaxed drop-shadow-md">
                        Easy integration with existing systems and workflows for maximum efficiency.
                      </p>
                      
                      <div className="flex justify-center gap-3">
                        <button className="button-primary text-sm px-4 py-2">
                          Get Started
                        </button>
                        <button className="button-secondary text-sm px-4 py-2">
                          Contact Us
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strip 4 - Bottom aligned overlay */}
      <div className="w-full py-8">
        <div className="container px-6 lg:px-8 mx-auto">
          <div className="max-w-5xl mx-auto">
            <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden shadow-elegant">
              <div className="relative h-72 md:h-[360px] lg:h-[450px]">
                <Image
                  src="/lovable-uploads/c3d5522b-6886-4b75-8ffc-d020016bb9c2.png" 
                  alt="24/7 continuous operation" 
                  fill
                  className="object-cover"
                />
                
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>
                
                {/* Bottom aligned text overlay */}
                <div className="absolute inset-0 flex items-end justify-center p-6 md:p-12">
                  <div className="bg-white/30 backdrop-blur-sm rounded-2xl p-6 md:p-8 max-w-3xl shadow-2xl border border-white/20">
                    <div className="text-center space-y-4">
                      <div className="inline-flex items-center justify-center w-12 h-12 bg-pulse-500 rounded-full mb-3">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      
                      <h3 className="text-xl md:text-2xl font-display font-bold text-white drop-shadow-lg">
                        24/7 Continuous Operation
                      </h3>
                      
                      <p className="text-white text-sm md:text-base leading-relaxed drop-shadow-md">
                        Reliable performance around the clock with minimal maintenance requirements.
                      </p>
                      
                      <div className="grid grid-cols-3 gap-6 mt-6">
                        <div className="text-center">
                          <div className="text-lg font-bold text-white drop-shadow-lg">99.9%</div>
                          <div className="text-xs text-white/80 drop-shadow-sm">Uptime</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-white drop-shadow-lg">24/7</div>
                          <div className="text-xs text-white/80 drop-shadow-sm">Operation</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-white drop-shadow-lg">&lt; 1hr</div>
                          <div className="text-xs text-white/80 drop-shadow-sm">Maintenance</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AlternatingStrips;
