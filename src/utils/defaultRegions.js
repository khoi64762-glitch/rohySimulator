const defaultRegions = {
  "anterior": {
    "male": {
      "headNeck": {"id": "headNeck","label": "Head & Neck","color": "#ff6b6b","points": [[43,4],[53,4],[57,9],[55,19],[42,19],[39,8]]},
      "chest": {"id": "chest","label": "Chest","color": "#ffa94d","points": [[38,18],[59,18],[64,20],[62,34],[33,34],[30,20]]},
      "upperArmLeft": {"id": "upperArmLeft","label": "L. Upper Arm","color": "#ffd43b","points": [[28,22],[33,20],[31,25],[33,36],[24,37],[25,33]]},
      "upperArmRight": {"id": "upperArmRight","label": "R. Upper Arm","color": "#ffd43b","points": [[64,21],[71,21],[71,32],[72,36],[64,37],[65,27]]},
      "forearmLeft": {"id": "forearmLeft","label": "L. Forearm","color": "#69db7c","points": [[24,37],[33,37],[32,41],[27,49],[20,48]]},
      "forearmRight": {"id": "forearmRight","label": "R. Forearm","color": "#69db7c","points": [[63,37],[73,37],[78,49],[71,50],[68,44]]},
      "handLeft": {"id": "handLeft","label": "L. Hand","color": "#4dabf7","points": [[18,49],[27,50],[23,59],[11,56]]},
      "handRight": {"id": "handRight","label": "R. Hand","color": "#4dabf7","points": [[70,50],[79,49],[87,57],[74,59]]},
      "abdomen": {"id": "abdomen","label": "Abdomen","color": "#9775fa","points": [[33,34],[63,34],[62,46],[35,46]]},
      "pelvis": {"id": "pelvis","label": "Pelvis","color": "#f06595","points": [[34,46],[62,46],[64,54],[33,54]]},
      "thighLeft": {"id": "thighLeft","label": "L. Thigh","color": "#20c997","points": [[33,54],[50,54],[45,74],[36,74]]},
      "thighRight": {"id": "thighRight","label": "R. Thigh","color": "#20c997","points": [[48,54],[64,54],[62,74],[51,74]]},
      "lowerLegLeft": {"id": "lowerLegLeft","label": "L. Lower Leg","color": "#38d9a9","points": [[35,74],[47,74],[46,91],[38,91]]},
      "lowerLegRight": {"id": "lowerLegRight","label": "R. Lower Leg","color": "#38d9a9","points": [[51,74],[62,74],[58,91],[50,91]]},
      "footLeft": {"id": "footLeft","label": "L. Foot","color": "#3bc9db","points": [[40,91],[46,91],[44,98],[34,98]]},
      "footRight": {"id": "footRight","label": "R. Foot","color": "#3bc9db","points": [[52,91],[59,91],[63,98],[51,98]]}
    },
    "female": {
      "headNeck": {"id": "headNeck","label": "Head & Neck","color": "#ff6b6b","points": [[40,2],[52,2],[56,7],[51,16],[41,16],[35,8]]},
      "chest": {"id": "chest","label": "Chest","color": "#ffa94d","points": [[40,16],[51,16],[63,19],[61,32],[32,32],[30,19]]},
      "upperArmLeft": {"id": "upperArmLeft","label": "L. Upper Arm","color": "#ffd43b","points": [[25,19],[31,19],[31,32],[30,36],[22,35],[22,29]]},
      "upperArmRight": {"id": "upperArmRight","label": "R. Upper Arm","color": "#ffd43b","points": [[63,18],[70,22],[70,35],[61,36],[61,32],[63,25]]},
      "forearmLeft": {"id": "forearmLeft","label": "L. Forearm","color": "#69db7c","points": [[21,34],[30,36],[29,42],[22,50],[16,50]]},
      "forearmRight": {"id": "forearmRight","label": "R. Forearm","color": "#69db7c","points": [[61,36],[70,35],[73,40],[76,48],[69,50]]},
      "handLeft": {"id": "handLeft","label": "L. Hand","color": "#4dabf7","points": [[14,50],[24,50],[18,61],[7,55]]},
      "handRight": {"id": "handRight","label": "R. Hand","color": "#4dabf7","points": [[69,49],[81,50],[83,59],[72,59]]},
      "abdomen": {"id": "abdomen","label": "Abdomen","color": "#9775fa","points": [[32,32],[58,32],[63,45],[29,45]]},
      "pelvis": {"id": "pelvis","label": "Pelvis","color": "#f06595","points": [[29,45],[64,45],[67,55],[26,55]]},
      "thighLeft": {"id": "thighLeft","label": "L. Thigh","color": "#20c997","points": [[26,55],[46,55],[45,73],[33,73]]},
      "thighRight": {"id": "thighRight","label": "R. Thigh","color": "#20c997","points": [[46,55],[67,55],[58,73],[47,73]]},
      "lowerLegLeft": {"id": "lowerLegLeft","label": "L. Lower Leg","color": "#38d9a9","points": [[33,73],[46,73],[43,90],[35,91]]},
      "lowerLegRight": {"id": "lowerLegRight","label": "R. Lower Leg","color": "#38d9a9","points": [[46,73],[60,73],[57,90],[49,90]]},
      "footLeft": {"id": "footLeft","label": "L. Foot","color": "#3bc9db","points": [[36,91],[43,91],[43,100],[30,99]]},
      "footRight": {"id": "footRight","label": "R. Foot","color": "#3bc9db","points": [[49,91],[57,91],[61,100],[47,100]]}
    }
  },
  "posterior": {
    "male": {
      "headNeck": {"id": "headNeck","label": "Head & Neck","color": "#ff6b6b","points": [[47.4,5],[55.2,5],[61.7,9],[59.1,17],[44.8,17],[40.9,10]]},
      "upperBack": {"id": "upperBack","label": "Upper Back","color": "#ffa94d","points": [[44.8,17],[59.1,17],[78.5,22],[72,31],[31.9,31],[24.1,22]]},
      "upperArmLeft": {"id": "upperArmLeft","label": "L. Upper Arm","color": "#ffd43b","points": [[20.2,38],[21.5,33],[21.5,30],[24.1,22],[31.9,31],[33.1,38]]},
      "upperArmRight": {"id": "upperArmRight","label": "R. Upper Arm","color": "#ffd43b","points": [[78.5,23],[82.4,30],[85,39],[72,40],[70.7,41],[72,32]]},
      "forearmLeft": {"id": "forearmLeft","label": "L. Forearm","color": "#69db7c","points": [[17.6,38],[31.9,39],[30.6,44],[25.4,51],[17.6,50]]},
      "forearmRight": {"id": "forearmRight","label": "R. Forearm","color": "#69db7c","points": [[70.7,41],[86.3,39],[86.3,49],[79.8,50],[74.6,47]]},
      "handLeft": {"id": "handLeft","label": "L. Hand","color": "#4dabf7","points": [[16.3,50],[24.1,51],[16.3,60],[3.3,55]]},
      "handRight": {"id": "handRight","label": "R. Hand","color": "#4dabf7","points": [[78.5,50],[87.6,49],[100,56],[86.3,60]]},
      "lowerBack": {"id": "lowerBack","label": "Lower Back","color": "#9775fa","points": [[33.1,31],[70.7,31],[69.4,44],[35.7,44]]},
      "buttocks": {"id": "buttocks","label": "Buttocks","color": "#f06595","points": [[34.4,44],[70.7,44],[73.3,54],[31.9,54]]},
      "thighLeft": {"id": "thighLeft","label": "L. Thigh","color": "#20c997","points": [[31.9,54],[51.3,54],[48.7,74],[37,74]]},
      "thighRight": {"id": "thighRight","label": "R. Thigh","color": "#20c997","points": [[52.6,54],[72,54],[66.9,74],[55.2,74]]},
      "calfLeft": {"id": "calfLeft","label": "L. Calf","color": "#38d9a9","points": [[35.7,74],[48.7,74],[47.4,90],[38.3,90]]},
      "calfRight": {"id": "calfRight","label": "R. Calf","color": "#38d9a9","points": [[53.9,74],[68.1,74],[65.6,90],[55.2,90]]},
      "heelLeft": {"id": "heelLeft","label": "L. Heel","color": "#3bc9db","points": [[39.6,90],[47.4,90],[50,99],[34.4,97]]},
      "heelRight": {"id": "heelRight","label": "R. Heel","color": "#3bc9db","points": [[56.5,90],[64.3,90],[69.4,98],[55.2,99]]}
    },
    "female": {
      "headNeck": {"id": "headNeck","label": "Head & Neck","color": "#ff6b6b","points": [[43.4,3],[55.3,3],[61.8,7],[56.6,16],[42.1,16],[38.2,7]]},
      "upperBack": {"id": "upperBack","label": "Upper Back","color": "#ffa94d","points": [[40.8,16],[57.9,16],[76.3,20],[68.4,32],[31.6,32],[23.7,20]]},
      "upperArmLeft": {"id": "upperArmLeft","label": "L. Upper Arm","color": "#ffd43b","points": [[22.4,21],[29,25],[31.6,33],[29,37],[19.8,36],[18.5,26]]},
      "upperArmRight": {"id": "upperArmRight","label": "R. Upper Arm","color": "#ffd43b","points": [[76.3,20],[80.2,25],[80.2,32],[81.5,35],[69.7,36],[68.4,32]]},
      "forearmLeft": {"id": "forearmLeft","label": "L. Forearm","color": "#69db7c","points": [[13.2,45],[18.5,36],[29,37],[22.4,50],[11.9,50]]},
      "forearmRight": {"id": "forearmRight","label": "R. Forearm","color": "#69db7c","points": [[69.7,37],[81.5,35],[88.1,49],[78.9,49],[72.3,42]]},
      "handLeft": {"id": "handLeft","label": "L. Hand","color": "#4dabf7","points": [[2.7,50],[21.1,50],[18.5,58],[5.3,58]]},
      "handRight": {"id": "handRight","label": "R. Hand","color": "#4dabf7","points": [[78.9,50],[94.7,49],[97.3,58],[86.8,58]]},
      "lowerBack": {"id": "lowerBack","label": "Lower Back","color": "#9775fa","points": [[31.6,32],[68.4,32],[71,44],[30.3,44]]},
      "buttocks": {"id": "buttocks","label": "Buttocks","color": "#f06595","points": [[29,44],[71,44],[73.7,56],[26.3,56]]},
      "thighLeft": {"id": "thighLeft","label": "L. Thigh","color": "#20c997","points": [[27.7,56],[50,56],[47.4,74],[34.2,74]]},
      "thighRight": {"id": "thighRight","label": "R. Thigh","color": "#20c997","points": [[50,56],[73.7,56],[65.8,74],[52.6,74]]},
      "calfLeft": {"id": "calfLeft","label": "L. Calf","color": "#38d9a9","points": [[34.2,74],[47.4,74],[44.7,90],[34.2,90]]},
      "calfRight": {"id": "calfRight","label": "R. Calf","color": "#38d9a9","points": [[52.6,74],[65.8,74],[64.5,90],[55.3,90]]},
      "heelLeft": {"id": "heelLeft","label": "L. Heel","color": "#3bc9db","points": [[34.2,90],[47.4,90],[47.4,100],[32.9,97]]},
      "heelRight": {"id": "heelRight","label": "R. Heel","color": "#3bc9db","points": [[52.6,90],[65.8,90],[67.1,97],[52.6,100]]}
    }
  }
}
export default defaultRegions;