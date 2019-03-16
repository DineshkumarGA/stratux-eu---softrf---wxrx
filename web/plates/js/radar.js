angular.module('appControllers').controller('RadarCtrl', RadarCtrl); // get the main module contollers set
RadarCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

var Lat;
var Long;
var GPSCourse = 0;
var BaroAltitude;   // Barometric Altitude if availabe, else set to GPS Altitude, invalid is -100.000
var DisplayRadius = 10;    // Radius in NM, below this radius targets are displayed
var MaxAlarms = 5;         // number of times an alarm sound is played, if airplane enters AlarmRadius
var minimalCircle = 25;    //minimal circle in pixcel around center ist distance is very close
var radar;    // global RadarRenderer
var posangle = 0;   //global var for angle position of text 

var zoom = [2,5,10,20,40];     // different zooms in nm
var zoomfactor = 2;   // start with 10 nm

var altDiff = [5,10,20,50,100,500];   // Threshold to display other planes within altitude difference in 100 ft
var altindex = 2;  // start with 2000 ft
var AltDiffThreshold;    // in 100 feet display value

//var stratuxip = "192.168.10.1";
//var situationuri = "http://" + stratuxip + "/getSituation";
var situation = {};


var sound_alert = new Audio('alert.wav');

function RadarCtrl($rootScope, $scope, $state, $http, $interval) {

        //  basics();
	$scope.$parent.helppage = 'plates/radar-help.html';
	$scope.data_list = [];
	$scope.data_list_invalid = [];

	function utcTimeString(epoc) {
		var time = "";
		var val;
		var d = new Date(epoc);
		val = d.getUTCHours();
		time += (val < 10 ? "0" + val : "" + val);
		val = d.getUTCMinutes();
		time += ":" + (val < 10 ? "0" + val : "" + val);
		val = d.getUTCSeconds();
		time += ":" + (val < 10 ? "0" + val : "" + val);
		time += "Z";
		return time;
	}

// chop off seconds for space
	function dmsString(val) {
		var deg;
		var min;
		deg = 0 | val;
		min = 0 | (val < 0 ? val = -val : val) % 1 * 60;
		
		return [deg*deg < 100 ? "0" + deg : deg,
				'° ',
				min < 10 ? "0" + min : min,
				"' "].join('');
	}

	function radiansRel (angle) {     //adopted from equations.go
		if (angle>180) angle = angle -360;
		if (angle<=-180) angle = angle +360;
		return angle * Math.PI / 180;
        }

	// get situation data and turn radar
	function ownSituation(data)
	{
	      situation = angular.fromJson(data);
	      // consider using angular.extend()
	      $scope.raw_data = angular.toJson(data, true); // makes it pretty
	      Lat = situation.GPSLatitude;
	      Long = situation.GPSLongitude;
	      GPSCourse = situation.GPSTrueCourse;
	      var press_time = Date.parse(situation.BaroLastMeasurementTime);
	      var gps_time = Date.parse(situation.GPSLastGPSTimeStratuxTime);
	      if (gps_time - press_time < 1000) {    //pressure is ok
		    BaroAltitude = Math.round(situation.BaroPressureAltitude.toFixed(0));
		    $scope.BaroAltValid = "Baro";
	      } else {
		   var gps_horizontal_accuracy = situation.GPSHorizontalAccuracy.toFixed(1);
		   if ( gps_horizontal_accuracy > 19999) {   //no valid gps signal
		       $scope.BaroAltValid = "Invalid";
		       BaroAltitude = -100000;   // marks invalid value
		   } else {
		       $scope.BaroAltValid = "GPS";
		       BaroAltitude= situation.GPSAltitudeMSL.toFixed(1);
		   }
	      }
	       var gps_horizontal_accuracy = situation.GPSHorizontalAccuracy.toFixed(1);
	       if ( gps_horizontal_accuracy > 19999) {   //no valid gps signal
		   $scope.GPSValid = "Invalid";
	       } else {
		   $scope.GPSValid = "Valid";
	       }
	       $scope.$apply();
	}

	function checkCollisionVector(traffic) {
		var doUpdate = 0;    //1 if update has to be done;
		var altDiff;   //difference of altitude to my altitude
		var distcirc = (-traffic.ema - 6) * (-traffic.ema -6) / 30;    //distance approx. in nm, 6dB for double distance
		var distx = Math.round(200/DisplayRadius * distcirc);   // x position for circle
		if (traffic.circ) {   //delete circle + Text
			traffic.circ.remove().forget();   // undisplay elements and clear children
			doUpdate = 1;
		}
		//console.log("Mode S %d traffic. Distance %f nm Distx %d \n", traffic.icao_int, distcirc, distx);
		if ( distx < minimalCircle ) distx = minimalCircle;
		if ( BaroAltitude > -100000 ) {  // valid BaroAlt or valid GPSAlt
		   altDiff = Math.round((traffic.altitude - BaroAltitude) / 100);;
		} else {
		   altDiff = traffic.altitude;   //take absolute altitude
		}
		if ( (Math.abs(altDiff) <= AltDiffThreshold ) && (distx <= 200)) {
			doUpdate=1;
			if ( distcirc<=(DisplayRadius/2) ) {
				if (!traffic.alarms) traffic.alarms = 0;
				if (traffic.alarms <=MaxAlarms ) sound_alert.play();  // play alarmtone max times
				traffic.alarms = traffic.alarms + 1;
			} else {
				traffic.alarms = 0;   // reset alarm counter, to play again
                        }
			traffic.circ = radar.allScreen.group();  //not rotated
    			var circle = radar.allScreen.circle(distx*2).cx(0).cy(0).addClass('greenCirc');
			traffic.circ.add(circle);
			if (!traffic.posangle)  {   //not yet with position for text
				traffic.posangle = posangle;
				posangle = posangle + 3*Math.PI/16;
			}
			var vorzeichen = "+";  
			if (altDiff < 0) vorzeichen = "-";
		        var outtext = radar.allScreen.text(vorzeichen+Math.abs(altDiff));
			outtext.center(Math.round(distx*Math.cos(traffic.posangle)),Math.round(distx*Math.sin(traffic.posangle)))
			  .addClass('textCOut'); //Outline in black 
			traffic.circ.add(outtext);
			var pfeil = "";
			if ( traffic.vspeed > 0 ) pfeil = '\u2191';
			if ( traffic.vspeed < 0 ) pfeil = '\u2193';
		        var tratext = radar.allScreen.text(vorzeichen+Math.abs(altDiff)+pfeil);
			tratext.center(Math.round(distx*Math.cos(traffic.posangle)),Math.round(distx*Math.sin(traffic.posangle)))
			  .addClass('textCirc'); //not rotated
			traffic.circ.add(tratext);
		} 
		if ( doUpdate == 1) radar.update();
        }

	function checkCollisionVectorValid(traffic) {
             	var radius_earth = 6371008.8;  // in meters
		//simplified from equations.go 
		var avgLat,distanceLat,distanceLng;
		var doUpdate = 0;

		if (traffic.planeimg) {   //delete Images + Text
			traffic.planeimg.remove().forget();
			traffic.planetext.remove().forget();  
			doUpdate = 1;
                }
		var altDiff;   //difference of altitude to my altitude
		if ( BaroAltitude > -100000 ) {  // valid BaroAlt or valid GPSAlt
		   altDiff = Math.round((traffic.altitude - BaroAltitude) / 100);;
		} else {
		   altDiff = traffic.altitude;   //take absolute altitude
                }
		if ( Math.abs(altDiff) > AltDiffThreshold )  {
		   if ( doUpdate == 1) radar.update();
                   return;    //finished
                }

		avgLat = radiansRel((Lat+traffic.lat)/2);
                distanceLat = (radiansRel(traffic.lat-Lat) * radius_earth) / 1852;
                distanceLng = ((radiansRel(traffic.lon-Long) * radius_earth) / 1852) * Math.abs(Math.cos(avgLat));

		var distx = Math.round(200 / DisplayRadius*distanceLng);
		var disty = -Math.round(200 / DisplayRadius*distanceLat);
		var distradius = Math.sqrt((distanceLat*distanceLat) + (distanceLng*distanceLng));   // pythagoras
		//console.log("Alt %f Long %f Lat %f DistanceLong %f DistLat %f Heading %f dx %d dy %d\n", traffic.altitude, traffic.lon, traffic.lat, distanceLat, distanceLng, traffic.heading, distx, disty);
		if ( distradius<=DisplayRadius ) {
		        doUpdate = 1;	
			if ( traffic.dist<=(DisplayRadius/2) ) {
				if (!traffic.alarms) traffic.alarms = 0;
				if (traffic.alarms <=MaxAlarms ) sound_alert.play();  // play alarmtone max 5 times
				traffic.alarms = traffic.alarms + 1;
			} else {
				traffic.alarms = 0;   // reset counter ones outside alarm circle
			}
			var heading = 0;
			if (traffic.heading != "---" ) heading = traffic.heading;  //sometimes heading is missing, then set to zero

			traffic.planeimg = radar.rScreen.group();
			traffic.planeimg.path("m 32,6.5 0.5,0.9 0.4,1.4 5.3,0.1 -5.3,0.1 0.1,0.5 0.3,0.1 0.6,0.4 0.4,0.4 0.4,0.8 1.1,7.1 0.1,0.8 3.7,1.7 22.2,1.3 0.5,0.1 0.3,0.3 0.3,0.7 0.2,6 -0.1,0.1 -26.5,2.8 -0.3,0.1 -0.4,0.3 -0.3,0.5 -0.1,0.3 -0.9,6.3 -1.7,10.3 9.5,0 0.2,0.1 0.2,0.2 -0.1,4.6 -0.2,0.2 -8.8,0 -1.1,-2.4 -0.2,2.5 -0.3,2.5 -0.3,-2.5 -0.2,-2.5 -1.1,2.4 -8.8,0 -0.2,-0.2 -0.1,-4.6 0.2,-0.2 0.2,-0.1 9.5,0 -1.7,-10.3 -0.9,-6.3 -0.1,-0.3 -0.3,-0.5 -0.4,-0.3 -0.3,-0.1 -26.5,-2.8 -0.1,-0.1 0.2,-6 0.3,-0.7 0.3,-0.3 0.5,-0.1 22.2,-1.3 3.7,-1.7 0,-0.8 1.2,-7.1 0.4,-0.8 0.4,-0.4 0.6,-0.4 0.3,-0.1 0.1,-0.5 -5.3,-0.1 5.3,-0.1 0.4,-1.4 z")
				.addClass('plane').size(20,20).center(distx,disty+3);
			traffic.planeimg.circle(2).center(distx,disty).fill("#000000");;
			traffic.planeimg.rotate(heading, distx, disty);

			var vorzeichen = "+";   
			if (altDiff < 0) vorzeichen = "-";
			var pfeil = "";
			if ( traffic.vspeed > 0 ) pfeil = '\u2191';
			if ( traffic.vspeed < 0 ) pfeil = '\u2193';
			traffic.planetext = radar.rScreen.text(vorzeichen + Math.abs(altDiff)+pfeil) 
                            .center(distx-6,disty-12).rotate(heading, distx, disty).addClass('textPlane');;
		} 
		if ( doUpdate == 1) radar.update();   // only necessary if changes were done
	}

	function expMovingAverage (oldema, newsignal, timelack) {
		var lambda = 0.3;
		if (!newsignal) {    //sometimes newsign=NaN
			return oldema;
		}
		if ( timelack < 0) {
			return newsignal;
		}
		var expon = Math.exp(-timelack/100*lambda);
	   	//console.log("Signal %f oldema %f timelack %f new_ema %f\n", newsignal, oldema, timelack, oldema*expon + newsignal*(1-expon));
		return oldema*expon + newsignal*(1-expon);
	}

	function setAircraft(obj, new_traffic) {
		new_traffic.icao_int = obj.Icao_addr;
		new_traffic.targettype = obj.TargetType;
		var timestamp = Date.parse(obj.Timestamp);
		var timeLack = -1;
		if (new_traffic.timeVal >0 ) {
			timeLack = timestamp - new_traffic.timeVal;
		} 
		new_traffic.timeVal = timestamp;
		new_traffic.time = utcTimeString(timestamp);
		new_traffic.signal = obj.SignalLevel;
		new_traffic.ema = expMovingAverage(new_traffic.ema, new_traffic.signal, timeLack);

		new_traffic.lat = obj.Lat;
		new_traffic.lon = obj.Lng;
		var n = Math.round(obj.Alt / 25) * 25;
		new_traffic.altitude = n;

   		if (obj.Speed_valid) {
                        new_traffic.heading = Math.round(obj.Track / 5) * 5;
                } else {
                        new_traffic.heading = "---";
                }
                new_traffic.vspeed = Math.round(obj.Vvel / 100) * 100


		new_traffic.age = obj.Age;
		new_traffic.ageLastAlt = obj.AgeLastAlt;
	}

	function onMessageNew (msg) {
			
		var message = JSON.parse(msg.data);
		//$scope.raw_data = angular.toJson(msg.data, true);
			
		// we need to use an array so AngularJS can perform sorting; it also means we need to loop to find an aircraft in the traffic set
		var validIdx = -1;
		var invalidIdx = -1;
		for (var i = 0, len = $scope.data_list.length; i < len; i++) {
			if ($scope.data_list[i].icao_int === message.Icao_addr) {
				setAircraft(message, $scope.data_list[i]);
				if (message.Position_valid) checkCollisionVectorValid($scope.data_list[i]);
				validIdx = i;
				break;
			}
		}
				
		if ( validIdx < 0 ) {   // not yet found
		   for (var i = 0, len = $scope.data_list_invalid.length; i < len; i++) {
			if ($scope.data_list_invalid[i].icao_int === message.Icao_addr) {
				setAircraft(message, $scope.data_list_invalid[i]);
				if (!message.Position_valid) checkCollisionVector($scope.data_list_invalid[i]);
				//console.log($scope.data_list_invalid[i]);
				invalidIdx = i;
				break;
			}
                   }
		}
		var new_traffic = {};
				
		if ((validIdx < 0) && (message.Position_valid)) {    //new aircraft with valid position
			setAircraft(message, new_traffic);
			checkCollisionVectorValid(new_traffic);
			$scope.data_list.unshift(new_traffic); // add to start of valid array.
		}

		if ((invalidIdx < 0) && (!message.Position_valid)) {     // new aircraft without position
			setAircraft(message, new_traffic);
			checkCollisionVector(new_traffic);
			$scope.data_list_invalid.unshift(new_traffic); // add to start of invalid array.
		}

		// Handle the negative cases of those above - where an aircraft moves from "valid" to "invalid" or vice-versa.
		if ((validIdx >= 0) && (!message.Position_valid)) {    //known valid aircraft now with invalid position
			// Position is not valid any more. Remove from "valid" table.
			if ( $scope.data_list[validIdx].planeimg ) { 
				$scope.data_list[validIdx].planeimg.remove().forget();  // remove plane image
				$scope.data_list[validIdx].planetext.remove().forget();  // remove plane image
			}
			$scope.data_list.splice(validIdx, 1);
		}

		if ((invalidIdx >= 0) && message.Position_valid) {   //known invalid aircraft now with valid position
			// Position is now valid. Remove from "invalid" table.
			if ($scope.data_list_invalid[invalidIdx].circ) {   //delete circle + Text
				$scope.data_list_invalid[invalidIdx].circ.remove().forget();
				delete $scope.data_list_invalid[invalidIdx].posangle;  //make sure angle is not used again
			
			}
			$scope.data_list_invalid.splice(invalidIdx, 1);
		}

		$scope.$apply();
	}

	function connect($scope) {
		if (($scope === undefined) || ($scope === null))
			return; // we are getting called once after clicking away from the status page

		if (($scope.socket === undefined) || ($scope.socket === null)) {
			socket = new WebSocket(URL_TRAFFIC_WS);
			$scope.socket = socket; // store socket in scope for enter/exit usage
                        sit_socket = new WebSocket(URL_GPS_WS);  // socket for situation
			$scope.sit_socket = sit_socket;
		}

		$scope.ConnectState = "Disconnected";

		socket.onopen = function (msg) {
			// $scope.ConnectStyle = "label-success";
			$scope.ConnectState = "Connected";
		};

		socket.onclose = function (msg) {
			// $scope.ConnectStyle = "label-danger";
			$scope.ConnectState = "Disconnected";
			$scope.$apply();
			setTimeout(connect, 1000);
		};

		socket.onerror = function (msg) {
			// $scope.ConnectStyle = "label-danger";
			$scope.ConnectState = "Problem";
			$scope.$apply();
		};

		socket.onmessage = function (msg) {
			//ownSituation($scope);   move to getclock
			onMessageNew(msg);
		        //radar.update();   moved to changes
		};

		sit_socket.onopen = function (msg) {
			//nothing, status is set with traffic port
		};

		sit_socket.onclose = function (msg) {
			setTimeout(connect, 1000);
		};

		sit_socket.onerror = function (msg) {
			//nothing, status is set with traffic port
		};

		sit_socket.onmessage = function (msg) {
			ownSituation(msg.data); 
		        radar.update(); 
		};
	}

	var getClock = $interval(function () {
		$http.get(URL_STATUS_GET).
		then(function (response) {
			globalStatus = angular.fromJson(response.data);
				
			var tempClock = new Date(Date.parse(globalStatus.Clock));
			var clockString = tempClock.toUTCString();
			$scope.Clock = clockString;

			var tempUptimeClock = new Date(Date.parse(globalStatus.UptimeClock));
			var uptimeClockString = tempUptimeClock.toUTCString();
			$scope.UptimeClock = uptimeClockString;

			var tempLocalClock = new Date;
			$scope.LocalClock = tempLocalClock.toUTCString();
			$scope.SecondsFast = (tempClock-tempLocalClock)/1000;
			
			$scope.GPS_connected = globalStatus.GPS_connected;
		        var boardtemp = globalStatus.CPUTemp;
		        if (boardtemp != undefined) {
			     /* boardtemp is celcius to tenths */
			     $scope.CPUTemp = boardtemp.toFixed(1);
		        }
			radar.update();
						
		}, function (response) {
			radar.update();  // just update, if status gets error
		});
	}, 500, 0, false);
		


	// perform cleanup every 10 seconds
	var clearStaleTraffic = $interval(function () {
		// remove stale aircraft = anything more than 59 seconds without a position update
		var cutoff = 59;

		// Clean up "valid position" table.
		for (var i = $scope.data_list.length; i > 0; i--) {
			if ($scope.data_list[i - 1].age >= cutoff) {
				if ( $scope.data_list[i-1].planeimg ) { 
					$scope.data_list[i-1].planeimg.remove().forget();  // remove plane image
					$scope.data_list[i-1].planetext.remove().forget();  // remove plane image
				}
				$scope.data_list.splice(i - 1, 1);
			}
		}

		// Clean up "invalid position" table.
		for (var i = $scope.data_list_invalid.length; i > 0; i--) {
			if (($scope.data_list_invalid[i - 1].age >= cutoff) || ($scope.data_list_invalid[i - 1].ageLastAlt >= cutoff)) {
				if ( $scope.data_list_invalid[i-1].circ ) {    // is displayed
				    $scope.data_list_invalid[i-1].circ.remove().forget(); 
				}
				$scope.data_list_invalid.splice(i - 1, 1);
			}
		}
	}, (1000 * 10), 0, false);


	$state.get('radar').onEnter = function () {
		// everything gets handled correctly by the controller
	};

	$state.get('radar').onExit = function () {
		// disconnect from the socket
		if (($scope.socket !== undefined) && ($scope.socket !== null)) {
			$scope.socket.close();
			$scope.socket = null;
		}
		// stop stale traffic cleanup
		$interval.cancel(clearStaleTraffic);
	};

	radar = new RadarRenderer ("radar_display",$scope);

	// Traffic Controller tasks
	connect($scope); // connect - opens a socket and listens for messages
}



function RadarRenderer(locationId,scope) {
    this.width = -1;
    this.height = -1;

    this.locationId = locationId;
    this.canvas = document.getElementById(this.locationId);
    this.resize();

    AltDiffThreshold = altDiff[altindex];	
    DisplayRadius = zoom[zoomfactor];	

    // Draw the radar using the svg.js library
    var radarAll = SVG(this.locationId).viewbox(-200, -200, 400, 400).group().addClass('radar');
    var card = radarAll.group().addClass('card');
    card.circle(400).cx(0).cy(0);  
    card.circle(200).cx(0).cy(0).stroke("white");  
    this.displayText = radarAll.text(DisplayRadius+' nm').addClass('textOutside').center(-165,190);  //not rotated
    this.altText = radarAll.text('\xB1'+AltDiffThreshold+'00ft').addClass('textOutsideRight').x(200).cy(190);  //not rotated
    card.text("N").addClass('textDir').center(0,-190);
    card.text("S").addClass('textDir').center(0,190);
    card.text("W").addClass('textDir').center(-190,0);
    card.text("E").addClass('textDir').center(190,0);

    var middle=radarAll.path("m 32,6.5 0.5,0.9 0.4,1.4 5.3,0.1 -5.3,0.1 0.1,0.5 0.3,0.1 0.6,0.4 0.4,0.4 0.4,0.8 1.1,7.1 0.1,0.8 3.7,1.7 22.2,1.3 0.5,0.1 0.3,0.3 0.3,0.7 0.2,6 -0.1,0.1 -26.5,2.8 -0.3,0.1 -0.4,0.3 -0.3,0.5 -0.1,0.3 -0.9,6.3 -1.7,10.3 9.5,0 0.2,0.1 0.2,0.2 -0.1,4.6 -0.2,0.2 -8.8,0 -1.1,-2.4 -0.2,2.5 -0.3,2.5 -0.3,-2.5 -0.2,-2.5 -1.1,2.4 -8.8,0 -0.2,-0.2 -0.1,-4.6 0.2,-0.2 0.2,-0.1 9.5,0 -1.7,-10.3 -0.9,-6.3 -0.1,-0.3 -0.3,-0.5 -0.4,-0.3 -0.3,-0.1 -26.5,-2.8 -0.1,-0.1 0.2,-6 0.3,-0.7 0.3,-0.3 0.5,-0.1 22.2,-1.3 3.7,-1.7 0,-0.8 1.2,-7.1 0.4,-0.8 0.4,-0.4 0.6,-0.4 0.3,-0.1 0.1,-0.5 -5.3,-0.1 5.3,-0.1 0.4,-1.4 z").fill("#FFFF00");
    middle.size(20,20).center(0,3).addClass('centerplane');
    radarAll.circle(2).center(0,0).fill("#000000");

    var zoomin = radarAll.group().cx(-170).cy(150).addClass('zoom');
    zoomin.circle(50).cx(0).cy(0).addClass('zoom');
    zoomin.text('Ra-').cx(12).cy(2).addClass('textZoom');
    zoomin.on('click', function () {
	var animateTime= 200;
        if (zoomfactor > 0 ) { 
		zoomfactor--;     
        } else {  
		animateTime = 20;
	}
        DisplayRadius = zoom[zoomfactor];	
	zoomin.animate(animateTime).rotate(90, 0, 0);
        this.displayText.text(DisplayRadius+' nm');
	//update();
        zoomin.animate(animateTime).rotate(0, 0, 0);
    }, this);

    var zoomout = radarAll.group().cx(-170).cy(-150).addClass('zoom');
    zoomout.circle(50).cx(0).cy(0).addClass('zoom');
    zoomout.text('Ra+').cx(12).cy(2).addClass('textZoom');
    zoomout.on('click', function () {
	var animateTime= 200;
        if (zoomfactor < (zoom.length-1) ) { 
		zoomfactor++;     
        } else {  
		animateTime = 20;
	}
        DisplayRadius = zoom[zoomfactor];	
	zoomout.animate(animateTime).rotate(90, 0, 0);
        //update();
        this.displayText.text(DisplayRadius+' nm');
        zoomout.animate(animateTime).rotate(0, 0, 0);
    }, this);

    var altmore = radarAll.group().cx(170).cy(-150).addClass('zoom');
    altmore.circle(50).cx(0).cy(0).addClass('zoom');
    altmore.text('Alt+').cx(12).cy(2).addClass('textZoom');
    altmore.on('click', function () {
	var animateTime= 200;
        if (altindex < (altDiff.length-1) ) { 
		altindex++;     
        } else {  
		animateTime = 20;
	}
        AltDiffThreshold = altDiff[altindex];	
	altmore.animate(animateTime).rotate(90, 0, 0);
        this.altText.text('\xB1'+AltDiffThreshold+'00ft');
	//update();
        altmore.animate(animateTime).rotate(0, 0, 0);
    }, this);

    var altless = radarAll.group().cx(170).cy(150).addClass('zoom');
    altless.circle(50).cx(0).cy(0).addClass('zoom');
    altless.text('Alt-').cx(12).cy(2).addClass('textZoom');
    altless.on('click', function () {
	var animateTime= 200;
        if (altindex > 0 ) { 
		altindex--;     
        } else {  
		animateTime = 20;
	}
        AltDiffThreshold = altDiff[altindex];	
	altless.animate(animateTime).rotate(90, 0, 0);
        //update();
        this.altText.text('\xB1'+AltDiffThreshold+'00ft');
        altless.animate(animateTime).rotate(0, 0, 0);
    }, this);


    this.allScreen = radarAll;
    this.rScreen = card;
}

RadarRenderer.prototype = {
    constructor: RadarRenderer,

    resize: function () {
        var canvasWidth = this.canvas.parentElement.offsetWidth - 12;

        if (canvasWidth !== this.width) {
            this.width = canvasWidth;
            this.height = canvasWidth * 0.5;

            this.canvas.width = this.width;
            this.canvas.height = this.height;
        }
    },

    update: function () {
	 if (this.fl) this.fl.remove();
	 this.rScreen.rotate(-GPSCourse,0,0);    // rotate conforming to GPSCourse
	 this.fl = this.allScreen.text("FL"+Math.round(BaroAltitude/100)).addClass('textSmall').move(7,5); 
    }
};
